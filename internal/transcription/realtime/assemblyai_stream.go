package realtime

// AssemblyAI Universal Streaming v3 WebSocket client.
//
// Endpoint : wss://streaming.assemblyai.com/v3/ws
// Auth     : Authorization: Bearer <api_key> header on the WS handshake
// Query    : sample_rate=16000&format_turns=true
// Audio    : binary WS messages, PCM-16 mono LE at 16 kHz (100 ms chunks)
// Inbound  : JSON messages – Begin | Turn | Termination
// Outbound : binary audio + {"type":"Terminate"} to close
//
// Speaker labels: AssemblyAI Streaming v3 has limited diarization support.
// If the API returns speaker fields on Turn words, they are used; otherwise
// all segments are attributed to SPEAKER_00.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"ascribe/pkg/logger"

	"github.com/gorilla/websocket"
)

const (
	assemblyAIWSURL = "wss://streaming.assemblyai.com/v3/ws"
)

// AssemblyAIClient implements ProviderClient for AssemblyAI Universal Streaming v3.
type AssemblyAIClient struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

// NewAssemblyAIClient constructs an AssemblyAIClient.
func NewAssemblyAIClient() *AssemblyAIClient {
	return &AssemblyAIClient{}
}

// Start opens the upstream WebSocket and returns a channel of normalised events.
func (c *AssemblyAIClient) Start(ctx context.Context, apiKey string, params map[string]any) (<-chan ProviderEvent, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+apiKey)

	url := assemblyAIWSURL + "?sample_rate=16000&format_turns=true"
	if lang, ok := params["language"].(string); ok && lang != "" && lang != "auto" {
		url += "&language_code=" + lang
	}

	conn, _, err := dialer.DialContext(ctx, url, headers)
	if err != nil {
		return nil, fmt.Errorf("assemblyai: dial failed: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	events := make(chan ProviderEvent, 64)

	go func() {
		defer close(events)
		defer conn.Close()

		for {
			_, msgBytes, err := conn.ReadMessage()
			if err != nil {
				// Ignore normal close errors.
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
					events <- ProviderEvent{Kind: "error", Err: fmt.Errorf("assemblyai read: %w", err), Recoverable: false}
					return
				}
			}

			var raw map[string]json.RawMessage
			if err := json.Unmarshal(msgBytes, &raw); err != nil {
				logger.Warn("assemblyai: failed to unmarshal message", "error", err)
				continue
			}

			msgTypeRaw, ok := raw["message_type"]
			if !ok {
				// Try "type" field too (older API shapes).
				msgTypeRaw = raw["type"]
			}
			var msgType string
			_ = json.Unmarshal(msgTypeRaw, &msgType)

			switch msgType {
			case "Begin", "SessionBegins":
				events <- ProviderEvent{Kind: "open"}

			case "Turn":
				// Parse the Turn message.
				var turn struct {
					Transcript     string  `json:"transcript"`
					TurnOrder      int     `json:"turn_order"`
					EndOfTurn      bool    `json:"end_of_turn"`
					TurnIsFormatted bool   `json:"turn_is_formatted"`
					Words          []struct {
						Text    string  `json:"text"`
						Start   float64 `json:"start"` // milliseconds
						End     float64 `json:"end"`
						Speaker string  `json:"speaker,omitempty"`
					} `json:"words"`
				}
				if err := json.Unmarshal(msgBytes, &turn); err != nil {
					continue
				}

				text := turn.Transcript
				if text == "" {
					continue
				}

				var startSec, endSec float64
				speaker := ""
				if len(turn.Words) > 0 {
					startSec = turn.Words[0].Start / 1000
					endSec = turn.Words[len(turn.Words)-1].End / 1000
					speaker = turn.Words[0].Speaker
				}

				if turn.EndOfTurn {
					events <- ProviderEvent{
						Kind:    "final_segment",
						Text:    text,
						Start:   startSec,
						End:     endSec,
						Speaker: speaker,
					}
				} else {
					events <- ProviderEvent{
						Kind:  "partial",
						Text:  text,
						Start: startSec,
						End:   endSec,
					}
				}

			case "Termination", "SessionTerminated":
				events <- ProviderEvent{Kind: "close"}
				return

			default:
				logger.Debug("assemblyai: unhandled message type", "type", msgType)
			}
		}
	}()

	return events, nil
}

// WriteAudio sends a binary PCM-16 frame to AssemblyAI.
func (c *AssemblyAIClient) WriteAudio(frame []byte) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("assemblyai: not connected")
	}
	return conn.WriteMessage(websocket.BinaryMessage, frame)
}

// Close sends the Terminate control message and closes the WebSocket.
func (c *AssemblyAIClient) Close() error {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.mu.Unlock()
	if conn == nil {
		return nil
	}
	// Send graceful terminate.
	terminate := map[string]string{"type": "Terminate"}
	data, _ := json.Marshal(terminate)
	_ = conn.WriteMessage(websocket.TextMessage, data)
	return conn.Close()
}
