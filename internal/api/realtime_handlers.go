package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ascribe/internal/models"
	"ascribe/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// wsUpgrader is used by the realtime WebSocket endpoint.
// CheckOrigin is deliberately permissive; auth is enforced via the token query
// param before the upgrade.
var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS is handled by the router middleware
	},
}

// StartRealtimeSessionRequest is the request body for POST /api/v1/transcription/realtime/start.
type StartRealtimeSessionRequest struct {
	Title    *string `json:"title,omitempty"`
	Provider string  `json:"provider" binding:"required,oneof=assemblyai deepgram"`
	Language string  `json:"language,omitempty"`
	Diarize  bool    `json:"diarize"`
	APIKey   string  `json:"api_key,omitempty"` // per-request override
}

// StartRealtimeSessionResponse is the response from POST …/realtime/start.
type StartRealtimeSessionResponse struct {
	JobID     string `json:"job_id"`
	SessionID string `json:"session_id"`
	WSURL     string `json:"ws_url"`
}

// StartRealtimeSession handles POST /api/v1/transcription/realtime/start.
//
// It creates a TranscriptionJob record (with AudioPath="pending"), starts the
// upstream provider WebSocket, and returns the session identifiers so the
// browser can open the WS audio channel.
func (h *Handler) StartRealtimeSession(c *gin.Context) {
	userID, ok := h.currentUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req StartRealtimeSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Resolve API key and language from the request or the user's profile.
	// Priority: explicit request field > env var (key only) > default profile > any visible profile.
	apiKey := req.APIKey
	if apiKey == "" {
		switch req.Provider {
		case "assemblyai":
			apiKey = h.config.AssemblyAIAPIKey
		case "deepgram":
			apiKey = h.config.DeepgramAPIKey
		}
	}

	// Resolved language — starts from the request, profile fills in if empty.
	language := req.Language

	if apiKey == "" || language == "" {
		// Look up the user's default profile to fill in missing values.
		if user, err := h.userService.GetUser(c.Request.Context(), userID); err == nil {
			var profile *models.TranscriptionProfile
			if user.DefaultProfileID != nil {
				role, _ := c.Get("role")
				roleStr, _ := role.(string)
				profile, _ = h.profileRepo.FindByIDForUser(c.Request.Context(), *user.DefaultProfileID, userID, roleStr)
			}
			if profile == nil {
				// No explicit default — use the first visible profile that has any useful data.
				if visible, err2 := h.profileRepo.ListVisibleToUser(c.Request.Context(), userID); err2 == nil {
					for i := range visible {
						if visible[i].Parameters.APIKey != nil && *visible[i].Parameters.APIKey != "" {
							profile = &visible[i]
							break
						}
					}
				}
			}
			if profile != nil {
				if apiKey == "" && profile.Parameters.APIKey != nil {
					apiKey = *profile.Parameters.APIKey
				}
				if language == "" && profile.Parameters.Language != nil && *profile.Parameters.Language != "" {
					language = *profile.Parameters.Language
					logger.Info("realtime: using language from profile", "language", language, "profile_id", profile.ID)
				}
			}
		}
	}
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no API key configured for provider " + req.Provider})
		return
	}

	// Determine model family string for the job parameters.
	modelFamily := req.Provider // "assemblyai" | "deepgram"

	jobID := uuid.New().String()
	pending := "pending"

	params := models.WhisperXParams{
		ModelFamily: modelFamily,
		Diarize:     req.Diarize,
	}
	if language != "" {
		params.Language = &language
	}
	if req.APIKey != "" {
		params.APIKey = &req.APIKey
	}

	job := models.TranscriptionJob{
		ID:            jobID,
		UserID:        userID,
		Title:         req.Title,
		Status:        models.StatusProcessing,
		StreamingMode: true,
		AudioPath:     pending,
		Diarization:   req.Diarize,
		Parameters:    params,
	}

	if err := h.jobRepo.Create(c.Request.Context(), &job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create job record"})
		return
	}

	// Build the provider params map (use resolved language, not raw req.Language).
	providerParams := map[string]any{
		"diarize":  req.Diarize,
		"language": language,
	}

	// Start the realtime session.
	sess, err := h.realtimeManager.Create(jobID, userID, req.Provider, apiKey, providerParams)
	if err != nil {
		logger.Error("realtime: failed to create session", "error", err)
		// Mark job as failed so it doesn't sit in processing forever.
		job.Status = models.StatusFailed
		errMsg := err.Error()
		job.ErrorMessage = &errMsg
		_ = h.jobRepo.Update(c.Request.Context(), &job)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to provider: " + err.Error()})
		return
	}

	// Patch the job with the session ID.
	job.SessionID = sess.ID
	if err := h.jobRepo.Update(c.Request.Context(), &job); err != nil {
		logger.Warn("realtime: failed to persist session_id on job", "job_id", jobID, "error", err)
	}

	// Broadcast the new job so the dashboard updates immediately.
	h.broadcaster.Broadcast(jobID, "job_update", gin.H{
		"job_id":    jobID,
		"status":    models.StatusProcessing,
		"streaming": true,
	})

	c.JSON(http.StatusOK, StartRealtimeSessionResponse{
		JobID:     jobID,
		SessionID: sess.ID,
		WSURL:     "/api/v1/transcription/realtime/ws?session_id=" + sess.ID,
	})
}

// RealtimeWebSocket handles GET /api/v1/transcription/realtime/ws.
//
// Auth is via ?token=<JWT> query parameter because browsers cannot set custom
// headers on WebSocket handshakes.  The token is validated before upgrading.
func (h *Handler) RealtimeWebSocket(c *gin.Context) {
	// 1. Validate token from query string.
	tokenStr := c.Query("token")
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}
	claims, err := h.authService.ValidateToken(tokenStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}
	userID := claims.UserID

	// 2. Look up session.
	sessionID := c.Query("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing session_id"})
		return
	}
	sess, ok := h.realtimeManager.Get(sessionID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	if sess.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// 3. Upgrade to WebSocket.
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error("realtime WS: upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	logger.Info("realtime WS: client connected", "session_id", sessionID)

	// 4. Read loop.
	var audioFrames int
	for {
		msgType, payload, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err,
				websocket.CloseNormalClosure,
				websocket.CloseGoingAway,
				websocket.CloseNoStatusReceived) {
				logger.Debug("realtime WS: read error", "session_id", sessionID, "error", err)
			}
			logger.Info("realtime WS: connection closed", "session_id", sessionID, "total_audio_frames", audioFrames)
			break
		}

		switch msgType {
		case websocket.BinaryMessage:
			audioFrames++
			if audioFrames == 1 {
				logger.Info("realtime WS: first audio frame received", "session_id", sessionID, "bytes", len(payload))
			}
			if writeErr := sess.WriteAudio(payload); writeErr != nil {
				logger.Warn("realtime WS: write audio error", "session_id", sessionID, "error", writeErr)
			}
		case websocket.TextMessage:
			// Only supported control message: {"type":"stop"}
			var ctrl struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(payload, &ctrl) == nil && ctrl.Type == "stop" {
				sess.Close()
				return
			}
		}
	}
}

// FinalizeRealtimeSession handles POST /api/v1/transcription/realtime/:id/finalize.
//
// Multipart body with an "audio" file field.  Saves the audio, marks the job
// completed, persists the final transcript, and removes the in-memory session.
func (h *Handler) FinalizeRealtimeSession(c *gin.Context) {
	jobID := c.Param("id")

	job, ok := h.requireJobOwner(c, jobID)
	if !ok {
		return
	}

	if !job.StreamingMode {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job is not a streaming job"})
		return
	}

	// Save audio file (multipart field "audio").
	header, err := c.FormFile("audio")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "audio file is required"})
		return
	}

	filePath, err := h.fileService.SaveUpload(header, h.config.UploadDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save audio file"})
		return
	}

	// Convert webm → mp3.  Loudnorm is intentionally omitted for streaming
	// recordings: the two-pass loudness analysis blocks the request for
	// minutes on long sessions and live-mic audio is already at consistent
	// levels.  Use a short FFmpeg timeout to keep the request snappy.
	if strings.ToLower(filepath.Ext(filePath)) == ".webm" {
		mp3Path := strings.TrimSuffix(filePath, filepath.Ext(filePath)) + ".mp3"
		// -vn   skip video stream (webm may carry a thumbnail)
		// -q:a 2  VBR ~190 kbps — good quality, much faster than CBR 320k
		cmd := exec.CommandContext(c.Request.Context(), "ffmpeg", "-y",
			"-i", filePath, "-vn", "-acodec", "libmp3lame", "-q:a", "2", mp3Path)
		if err := cmd.Run(); err != nil {
			_ = h.fileService.RemoveFile(filePath)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to convert audio to MP3"})
			return
		}
		_ = h.fileService.RemoveFile(filePath)
		filePath = mp3Path
	}

	// Persist the final transcript snapshot if the session is still alive.
	startedAt := job.CreatedAt
	var transcript *string
	if sess, found := h.realtimeManager.Get(job.SessionID); found {
		startedAt = sess.StartedAt
		if snap, snapErr := sess.Snapshot(); snapErr == nil {
			snapStr := string(snap)
			transcript = &snapStr
		}
	}

	// Update the job.
	job.AudioPath = filePath
	job.Status = models.StatusCompleted
	if transcript != nil {
		job.Transcript = transcript
	}
	if err := h.jobRepo.Update(c.Request.Context(), job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update job"})
		return
	}

	// Create execution record for parity with normal jobs.
	now := time.Now()
	exec := models.TranscriptionJobExecution{
		TranscriptionJobID: jobID,
		StartedAt:          startedAt,
		CompletedAt:        &now,
		Status:             models.StatusCompleted,
		ActualParameters:   job.Parameters,
	}
	exec.CalculateProcessingDuration()
	if createErr := h.jobRepo.CreateExecution(context.Background(), &exec); createErr != nil {
		logger.Warn("realtime: failed to create execution record", "job_id", jobID, "error", createErr)
	}

	// Close and remove the in-memory session.
	if job.SessionID != "" {
		h.realtimeManager.Remove(job.SessionID)
	}

	// Broadcast completion.
	h.broadcaster.Broadcast(jobID, "job_update", gin.H{
		"job_id": jobID,
		"status": models.StatusCompleted,
	})

	logger.Info("realtime: session finalized", "job_id", jobID)
	c.JSON(http.StatusOK, job)
}
