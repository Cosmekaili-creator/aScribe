// Package realtime implements the server-side of the real-time transcription
// pipeline.  Two upstream providers are supported (AssemblyAI Universal
// Streaming v3 and Deepgram Live), both implementing the ProviderClient
// interface defined here.
package realtime

import "context"

// ProviderEvent is the normalised event emitted by a ProviderClient to the
// session's run loop.
type ProviderEvent struct {
	// Kind is one of: "open" | "partial" | "clear_partial" | "final_segment" |
	// "speaker" | "error" | "close"
	//
	// "clear_partial" is emitted when the provider finalises a segment with an
	// empty transcript (silence endpoint): there is nothing to commit but the
	// running partial should be cleared from the UI.
	Kind string

	// Text holds the partial transcript or the final segment text.
	Text string

	// Start / End are the segment boundaries in seconds from session start.
	Start float64
	End   float64

	// Speaker is the raw provider label (e.g. "A", "0", "speaker_0").
	// Empty when diarization is disabled or the provider did not return one.
	Speaker string

	// Confidence is the provider's confidence score (0–1), if available.
	Confidence float64

	// Err is set on Kind="error".
	Err error

	// Recoverable is set on Kind="error": true means the stream can continue
	// (e.g. a single bad frame); false means the connection is broken and the
	// session should be closed.
	Recoverable bool
}

// ProviderClient abstracts a single upstream WebSocket connection to a
// real-time transcription provider.
type ProviderClient interface {
	// Start opens the upstream WS and returns a read-only channel of events.
	// Cancel the supplied context to request termination.  The channel is
	// closed when the upstream connection ends (cleanly or on error).
	Start(ctx context.Context, apiKey string, params map[string]any) (<-chan ProviderEvent, error)

	// WriteAudio sends a binary PCM-16 LE mono 16 kHz frame to the provider.
	WriteAudio(frame []byte) error

	// Close sends the provider's end-of-stream sentinel and closes the upstream
	// WebSocket.  Idempotent.
	Close() error
}
