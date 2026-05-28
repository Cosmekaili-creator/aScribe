package realtime

// Deepgram Live WebSocket client.
//
// Endpoint : wss://api.deepgram.com/v1/listen
// Auth     : Authorization: Token <api_key> header on the WS handshake
// Query    : model, encoding, sample_rate, channels, interim_results, punctuate,
//            smart_format, diarize, language
// Audio    : binary WS messages, PCM-16 mono LE at 16 kHz (100 ms chunks)
// Inbound  : JSON {"type":"Results"|"Metadata"|"UtteranceEnd"|"Error"|"Close"}
// Outbound : binary audio + {"type":"CloseStream"} to gracefully end the session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"ascribe/pkg/logger"

	"github.com/gorilla/websocket"
)

const deepgramWSURL = "wss://api.deepgram.com/v1/listen"

// DeepgramClient implements ProviderClient for Deepgram Live.
type DeepgramClient struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

// NewDeepgramClient constructs a DeepgramClient.
func NewDeepgramClient() *DeepgramClient {
	return &DeepgramClient{}
}

// Start opens the Deepgram Live WebSocket and returns a channel of events.
func (c *DeepgramClient) Start(ctx context.Context, apiKey string, params map[string]any) (<-chan ProviderEvent, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}

	headers := http.Header{}
	headers.Set("Authorization", "Token "+apiKey)

	// Build query parameters.
	qp := []string{
		"encoding=linear16",
		"sample_rate=16000",
		"channels=1",
		"interim_results=true",
		"punctuate=true",
		"smart_format=true",
	}

	if model, ok := params["model"].(string); ok && model != "" {
		qp = append(qp, "model="+model)
	} else {
		qp = append(qp, "model=nova-2")
	}
	if lang, ok := params["language"].(string); ok && lang != "" && lang != "auto" {
		qp = append(qp, "language="+lang)
	}
	if diarize, ok := params["diarize"].(bool); ok && diarize {
		qp = append(qp, "diarize=true")
	}

	url := deepgramWSURL + "?" + strings.Join(qp, "&")

	conn, _, err := dialer.DialContext(ctx, url, headers)
	if err != nil {
		return nil, fmt.Errorf("deepgram: dial failed: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	events := make(chan ProviderEvent, 64)

	go func() {
		defer close(events)
		defer conn.Close()

		// Emit open immediately — Deepgram doesn't send a "connected" message.
		events <- ProviderEvent{Kind: "open"}
		logger.Info("deepgram: WebSocket open, waiting for messages")

		for {
			_, msgBytes, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err,
					websocket.CloseNormalClosure,
					websocket.CloseGoingAway,
					websocket.CloseNoStatusReceived) {
					events <- ProviderEvent{Kind: "close"}
					return
				}
				select {
				case <-ctx.Done():
					return
				default:
					events <- ProviderEvent{Kind: "error", Err: fmt.Errorf("deepgram read: %w", err), Recoverable: false}
					return
				}
			}

			var envelope struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(msgBytes, &envelope); err != nil {
				logger.Warn("deepgram: failed to parse message", "bytes", len(msgBytes), "raw", string(msgBytes[:min(len(msgBytes), 200)]))
				continue
			}

			switch envelope.Type {
			case "Results":
				c.handleResults(msgBytes, events)
			case "Metadata":
				// ignore
			case "UtteranceEnd":
				// ignore — we already emit final_segment on is_final
			case "Error":
				var e struct{ Message string `json:"message"` }
				_ = json.Unmarshal(msgBytes, &e)
				events <- ProviderEvent{
					Kind:        "error",
					Err:         fmt.Errorf("deepgram error: %s", e.Message),
					Recoverable: false,
				}
			case "Close":
				events <- ProviderEvent{Kind: "close"}
				return
			default:
				logger.Debug("deepgram: unhandled message type", "type", envelope.Type)
			}
		}
	}()

	return events, nil
}

// deepgramResultsMsg is the Results payload from Deepgram Live.
type deepgramResultsMsg struct {
	Type    string `json:"type"`
	IsFinal bool   `json:"is_final"`
	Channel struct {
		Alternatives []struct {
			Transcript string  `json:"transcript"`
			Confidence float64 `json:"confidence"`
			Words      []struct {
				Word            string  `json:"word"`
				PunctuatedWord  string  `json:"punctuated_word"`
				Start           float64 `json:"start"`
				End             float64 `json:"end"`
				Confidence      float64 `json:"confidence"`
				Speaker         *int    `json:"speaker,omitempty"`
				SpeakerConfidence float64 `json:"speaker_confidence,omitempty"`
			} `json:"words"`
		} `json:"alternatives"`
	} `json:"channel"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
}

func (c *DeepgramClient) handleResults(msgBytes []byte, events chan<- ProviderEvent) {
	var r deepgramResultsMsg
	if err := json.Unmarshal(msgBytes, &r); err != nil || len(r.Channel.Alternatives) == 0 {
		return
	}

	alt := r.Channel.Alternatives[0]
	text := alt.Transcript
	if text == "" {
		// When the provider finalises a silence segment, clear the running
		// partial so the UI doesn't linger on stale interim text.
		if r.IsFinal {
			events <- ProviderEvent{Kind: "clear_partial"}
		}
		return
	}

	if !r.IsFinal {
		events <- ProviderEvent{
			Kind:  "partial",
			Text:  text,
			Start: r.Start,
			End:   r.Start + r.Duration,
		}
		return
	}

	// Final: group words by speaker into segments.
	if len(alt.Words) > 0 {
		segs := deepgramGroupBySpeaker(alt.Words)
		for _, seg := range segs {
			events <- ProviderEvent{
				Kind:    "final_segment",
				Text:    seg.text,
				Start:   seg.start,
				End:     seg.end,
				Speaker: seg.speaker,
			}
		}
	} else {
		events <- ProviderEvent{
			Kind:  "final_segment",
			Text:  text,
			Start: r.Start,
			End:   r.Start + r.Duration,
		}
	}
}

type dgSeg struct {
	text    string
	start   float64
	end     float64
	speaker string
}

// deepgramGroupBySpeaker groups words into segments split on speaker changes.
func deepgramGroupBySpeaker(words []struct {
	Word            string  `json:"word"`
	PunctuatedWord  string  `json:"punctuated_word"`
	Start           float64 `json:"start"`
	End             float64 `json:"end"`
	Confidence      float64 `json:"confidence"`
	Speaker         *int    `json:"speaker,omitempty"`
	SpeakerConfidence float64 `json:"speaker_confidence,omitempty"`
}) []dgSeg {
	var segs []dgSeg
	if len(words) == 0 {
		return segs
	}

	cur := dgSeg{
		start: words[0].Start,
	}
	if words[0].Speaker != nil {
		cur.speaker = fmt.Sprintf("%d", *words[0].Speaker)
	}

	var texts []string
	for i, w := range words {
		word := w.PunctuatedWord
		if word == "" {
			word = w.Word
		}
		if i > 0 {
			prev := words[i-1]
			prevSpeaker := ""
			curSpeaker := ""
			if prev.Speaker != nil {
				prevSpeaker = fmt.Sprintf("%d", *prev.Speaker)
			}
			if w.Speaker != nil {
				curSpeaker = fmt.Sprintf("%d", *w.Speaker)
			}
			if prevSpeaker != curSpeaker {
				// flush current segment
				cur.text = strings.Join(texts, " ")
				cur.end = prev.End
				segs = append(segs, cur)
				texts = nil
				cur = dgSeg{start: w.Start, speaker: curSpeaker}
			}
		}
		texts = append(texts, word)
	}
	// flush last
	cur.text = strings.Join(texts, " ")
	cur.end = words[len(words)-1].End
	segs = append(segs, cur)
	return segs
}

// WriteAudio sends a binary PCM-16 frame to Deepgram.
func (c *DeepgramClient) WriteAudio(frame []byte) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("deepgram: not connected")
	}
	return conn.WriteMessage(websocket.BinaryMessage, frame)
}

// Close sends CloseStream to Deepgram and closes the WebSocket.
func (c *DeepgramClient) Close() error {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()
	if conn == nil {
		return nil
	}
	closeMsg := map[string]string{"type": "CloseStream"}
	data, _ := json.Marshal(closeMsg)
	_ = conn.WriteMessage(websocket.TextMessage, data)
	return conn.Close()
}
