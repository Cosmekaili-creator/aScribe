package realtime

// SSE event types broadcast by a realtime session.
//
// | Event type              | Payload shape                                         | When                              |
// |-------------------------|-------------------------------------------------------|-----------------------------------|
// | job_update (existing)   | { job_id, status, error?, streaming? }                | Job status transitions            |
// | realtime_partial        | { session_id, job_id, text, speaker?, start_ms, end_ms } | Interim text, replaces prior in UI |
// | realtime_segment        | { session_id, job_id, segment_index, start, end, text, speaker } | Committed segment, append to UI |
// | realtime_speaker        | { session_id, job_id, original_speaker, first_seen_at } | New speaker label appears (first time) |
// | realtime_error          | { session_id, job_id, error, recoverable }            | Transient or fatal upstream error |
// | realtime_session_ended  | { session_id, job_id, segment_count }                 | Upstream WS closed cleanly        |

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"ascribe/internal/repository"
	"ascribe/internal/sse"
	"ascribe/internal/transcription/interfaces"
	"ascribe/pkg/logger"
)

const (
	// persistInterval controls how often the transcript snapshot is flushed to DB.
	persistInterval = 5 * time.Second
	// persistSegmentCount flushes after this many new segments, whichever comes first.
	persistSegmentCount = 3
)

// Session represents a single real-time transcription session.
type Session struct {
	ID        string
	JobID     string
	UserID    uint
	Provider  string // "assemblyai" | "deepgram"
	StartedAt time.Time
	LastSeen  time.Time // updated on every WriteAudio call; used by the reaper

	client      ProviderClient
	cancel      context.CancelFunc
	broadcaster *sse.Broadcaster
	jobRepo     repository.JobRepository

	mu              sync.Mutex
	segments        []interfaces.TranscriptSegment
	speakerCounter  map[string]int // raw label → first-seen index
	lastPartial     string
	closed          bool
	audioFrameCount int // diagnostic: total PCM frames forwarded to provider

	// persistence throttling
	segmentsSinceFlush int
	lastFlush          time.Time
}

// Run consumes events from the ProviderClient and drives SSE + persistence.
// Returns when the upstream channel closes or ctx is cancelled.
func (s *Session) Run(ctx context.Context, events <-chan ProviderEvent) {
	defer func() {
		s.mu.Lock()
		frames := s.audioFrameCount
		segs := len(s.segments)
		s.mu.Unlock()
		logger.Info("realtime: session run exiting",
			"session_id", s.ID, "job_id", s.JobID,
			"audio_frames_received", frames, "segments_produced", segs)

		// Always persist the final snapshot when Run exits.
		if err := s.flushSnapshot(context.Background()); err != nil {
			logger.Error("realtime: failed to flush final snapshot", "job_id", s.JobID, "error", err)
		}
		s.broadcaster.Broadcast(s.JobID, "realtime_session_ended", map[string]interface{}{
			"session_id":    s.ID,
			"job_id":        s.JobID,
			"segment_count": s.segmentCount(),
		})
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			s.handleEvent(ctx, ev)
		}
	}
}

func (s *Session) handleEvent(ctx context.Context, ev ProviderEvent) {
	switch ev.Kind {
	case "open":
		logger.Debug("realtime: upstream open", "session_id", s.ID, "provider", s.Provider)

	case "clear_partial":
		// Provider finalised a silence segment — clear partial without committing a segment.
		s.mu.Lock()
		s.lastPartial = ""
		s.mu.Unlock()
		s.broadcaster.Broadcast(s.JobID, "realtime_partial", map[string]interface{}{
			"session_id": s.ID,
			"job_id":     s.JobID,
			"text":       "",
			"start_ms":   0,
			"end_ms":     0,
		})

	case "partial":
		s.mu.Lock()
		s.lastPartial = ev.Text
		s.mu.Unlock()
		s.broadcaster.Broadcast(s.JobID, "realtime_partial", map[string]interface{}{
			"session_id": s.ID,
			"job_id":     s.JobID,
			"text":       ev.Text,
			"start_ms":   int64(ev.Start * 1000),
			"end_ms":     int64(ev.End * 1000),
		})

	case "final_segment":
		s.mu.Lock()

		// Normalize speaker; normalizeSpeaker returns (label, isNew) so we
		// get exactly one realtime_speaker event per unique raw label.
		normalizedSpeaker, isNewSpeaker := normalizeSpeaker(ev.Speaker, s.speakerCounter)

		seg := interfaces.TranscriptSegment{
			Start:   ev.Start,
			End:     ev.End,
			Text:    ev.Text,
			Speaker: &normalizedSpeaker,
		}
		s.segments = append(s.segments, seg)
		idx := len(s.segments) - 1
		s.segmentsSinceFlush++
		s.lastPartial = ""

		needFlush := s.segmentsSinceFlush >= persistSegmentCount ||
			time.Since(s.lastFlush) >= persistInterval

		s.mu.Unlock()

		// Broadcast new speaker (only once per unique speaker).
		if isNewSpeaker {
			s.broadcaster.Broadcast(s.JobID, "realtime_speaker", map[string]interface{}{
				"session_id":      s.ID,
				"job_id":          s.JobID,
				"original_speaker": normalizedSpeaker,
				"first_seen_at":   ev.Start,
			})
		}

		// Broadcast committed segment.
		s.broadcaster.Broadcast(s.JobID, "realtime_segment", map[string]interface{}{
			"session_id":    s.ID,
			"job_id":        s.JobID,
			"segment_index": idx,
			"start":         ev.Start,
			"end":           ev.End,
			"text":          ev.Text,
			"speaker":       normalizedSpeaker,
		})

		// Persist to DB if threshold reached.
		if needFlush {
			if err := s.flushSnapshot(ctx); err != nil {
				logger.Error("realtime: flush snapshot failed", "job_id", s.JobID, "error", err)
			}
		}

	case "error":
		// ev.Recoverable distinguishes transient from fatal upstream errors.
		// ev.Err is always non-nil for Kind="error".
		s.broadcaster.Broadcast(s.JobID, "realtime_error", map[string]interface{}{
			"session_id":  s.ID,
			"job_id":      s.JobID,
			"error":       ev.Err.Error(),
			"recoverable": ev.Recoverable,
		})
		logger.Warn("realtime: provider error", "session_id", s.ID, "recoverable", ev.Recoverable, "error", ev.Err)
		// Close the session on fatal (non-recoverable) errors so the browser
		// knows the stream is done and the reaper doesn't need to wait.
		if !ev.Recoverable {
			go s.Close()
		}

	case "close":
		logger.Debug("realtime: upstream closed cleanly", "session_id", s.ID)
		// Run's deferred flush handles persistence.
	}
}

// WriteAudio forwards a raw PCM-16 frame to the upstream provider.
func (s *Session) WriteAudio(frame []byte) error {
	s.mu.Lock()
	s.LastSeen = time.Now()
	s.audioFrameCount++
	s.mu.Unlock()
	return s.client.WriteAudio(frame)
}

// Close terminates the upstream connection and marks the session closed.
// It does NOT set job status — that happens during finalize.
func (s *Session) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	s.cancel()
	_ = s.client.Close()
}

// Snapshot returns the current accumulated transcript as a JSON blob compatible
// with the existing { text, segments, word_segments } shape.
func (s *Session) Snapshot() ([]byte, error) {
	s.mu.Lock()
	segs := make([]interfaces.TranscriptSegment, len(s.segments))
	copy(segs, s.segments)
	s.mu.Unlock()

	// Build full text from segments.
	fullText := ""
	for i, seg := range segs {
		if i > 0 {
			fullText += " "
		}
		fullText += seg.Text
	}

	blob := map[string]interface{}{
		"text":          fullText,
		"segments":      segs,
		"word_segments": []interface{}{},
		"metadata": map[string]string{
			"provider": s.Provider,
		},
	}
	return json.Marshal(blob)
}

// segmentCount returns the number of committed segments (thread-safe).
func (s *Session) segmentCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.segments)
}

// flushSnapshot persists the current transcript snapshot to the database.
func (s *Session) flushSnapshot(ctx context.Context) error {
	snap, err := s.Snapshot()
	if err != nil {
		return err
	}
	if err := s.jobRepo.UpdateTranscript(ctx, s.JobID, string(snap)); err != nil {
		return err
	}
	s.mu.Lock()
	s.segmentsSinceFlush = 0
	s.lastFlush = time.Now()
	s.mu.Unlock()
	return nil
}
