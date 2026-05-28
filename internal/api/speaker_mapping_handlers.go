package api

import (
	"encoding/json"
	"net/http"
	"sort"

	"ascribe/internal/models"
	"ascribe/internal/transcription/interfaces"

	"github.com/gin-gonic/gin"
)

// SpeakerMappingRequest represents a speaker mapping update request
type SpeakerMappingRequest struct {
	OriginalSpeaker string `json:"original_speaker" binding:"required"`
	CustomName      string `json:"custom_name" binding:"required"`
}

// SpeakerMappingsUpdateRequest represents a bulk speaker mappings update
type SpeakerMappingsUpdateRequest struct {
	Mappings []SpeakerMappingRequest `json:"mappings" binding:"required"`
}

// SpeakerMappingResponse represents a speaker mapping response
type SpeakerMappingResponse struct {
	ID              uint   `json:"id"`
	OriginalSpeaker string `json:"original_speaker"`
	CustomName      string `json:"custom_name"`
}

// SpeakerSampleSegment represents a sample quote for the speaker wizard.
type SpeakerSampleSegment struct {
	Start float64 `json:"start"`
	Text  string  `json:"text"`
}

// SpeakerMappingsWithSamplesResponse is returned when ?include_samples=true.
type SpeakerMappingsWithSamplesResponse struct {
	Mappings []SpeakerMappingResponse               `json:"mappings"`
	Samples  map[string][]SpeakerSampleSegment      `json:"samples"`
}

// GetSpeakerMappings retrieves all speaker mappings for a transcription.
// When ?include_samples=true is supplied the response shape changes to
// SpeakerMappingsWithSamplesResponse (backward-compatible: without the param,
// the response is still a plain array).
// @Summary Get speaker mappings for a transcription
// @Description Retrieves all custom speaker names for a transcription job
// @Tags transcription
// @Produce json
// @Param id path string true "Transcription Job ID"
// @Param include_samples query bool false "Include sample segments per speaker"
// @Success 200 {array} SpeakerMappingResponse
// @Failure 400 {object} map[string]string
// @Failure 404 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Security BearerAuth
// @Security ApiKeyAuth
// @Router /api/v1/transcription/{id}/speakers [get]
func (h *Handler) GetSpeakerMappings(c *gin.Context) {
	jobID := c.Param("id")

	job, ok := h.requireJobOwner(c, jobID)
	if !ok {
		return
	}

	// Check if diarization was enabled or if this is a multi-track job (which also has speakers)
	// If no speaker info available, return empty array instead of error for graceful frontend handling
	if !job.Diarization && !job.Parameters.Diarize && !job.IsMultiTrack && !job.StreamingMode {
		if c.Query("include_samples") == "true" {
			c.JSON(http.StatusOK, SpeakerMappingsWithSamplesResponse{
				Mappings: []SpeakerMappingResponse{},
				Samples:  map[string][]SpeakerSampleSegment{},
			})
			return
		}
		c.JSON(http.StatusOK, []SpeakerMappingResponse{})
		return
	}

	// Get speaker mappings
	mappings, err := h.speakerMappingRepo.ListByJob(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get speaker mappings"})
		return
	}

	// Convert to response format
	response := make([]SpeakerMappingResponse, len(mappings))
	for i, mapping := range mappings {
		response[i] = SpeakerMappingResponse{
			ID:              mapping.ID,
			OriginalSpeaker: mapping.OriginalSpeaker,
			CustomName:      mapping.CustomName,
		}
	}

	// Without include_samples: return the plain array (backward-compatible).
	if c.Query("include_samples") != "true" {
		c.JSON(http.StatusOK, response)
		return
	}

	// Build samples map: parse transcript segments and pick the top-3 longest
	// per speaker (≥20 chars), ordered by start time.
	samples := buildSpeakerSamples(job)

	c.JSON(http.StatusOK, SpeakerMappingsWithSamplesResponse{
		Mappings: response,
		Samples:  samples,
	})
}

// buildSpeakerSamples parses job.Transcript and picks up to 3 representative
// segments per speaker.
func buildSpeakerSamples(job *models.TranscriptionJob) map[string][]SpeakerSampleSegment {
	samples := make(map[string][]SpeakerSampleSegment)

	if job.Transcript == nil {
		return samples
	}

	var blob struct {
		Segments []interfaces.TranscriptSegment `json:"segments"`
	}
	if err := json.Unmarshal([]byte(*job.Transcript), &blob); err != nil {
		return samples
	}

	// Bucket segments by speaker.
	bySpeaker := make(map[string][]interfaces.TranscriptSegment)
	for _, seg := range blob.Segments {
		speaker := "SPEAKER_00"
		if seg.Speaker != nil && *seg.Speaker != "" {
			speaker = *seg.Speaker
		}
		bySpeaker[speaker] = append(bySpeaker[speaker], seg)
	}

	const minChars = 20
	const maxSamples = 3

	for speaker, segs := range bySpeaker {
		// Sort by length descending to pick the most informative quotes.
		sort.Slice(segs, func(i, j int) bool {
			return len(segs[i].Text) > len(segs[j].Text)
		})

		var picked []SpeakerSampleSegment
		for _, seg := range segs {
			if len(seg.Text) < minChars {
				continue
			}
			picked = append(picked, SpeakerSampleSegment{
				Start: seg.Start,
				Text:  seg.Text,
			})
			if len(picked) >= maxSamples {
				break
			}
		}

		// Sort the selected samples by start time for display.
		sort.Slice(picked, func(i, j int) bool {
			return picked[i].Start < picked[j].Start
		})
		samples[speaker] = picked
	}
	return samples
}

// UpdateSpeakerMappings updates speaker mappings for a transcription
// @Summary Update speaker mappings for a transcription
// @Description Updates or creates custom speaker names for a transcription job
// @Tags transcription
// @Accept json
// @Produce json
// @Param id path string true "Transcription Job ID"
// @Param request body SpeakerMappingsUpdateRequest true "Speaker mappings to update"
// @Success 200 {array} SpeakerMappingResponse
// @Failure 400 {object} map[string]string
// @Failure 404 {object} map[string]string
// @Failure 500 {object} map[string]string
// @Security BearerAuth
// @Security ApiKeyAuth
// @Router /api/v1/transcription/{id}/speakers [post]
func (h *Handler) UpdateSpeakerMappings(c *gin.Context) {
	jobID := c.Param("id")

	var req SpeakerMappingsUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	job, ok := h.requireJobOwner(c, jobID)
	if !ok {
		return
	}

	// Check if diarization was enabled or if this is a multi-track / streaming job (which also has speakers)
	if !job.Diarization && !job.Parameters.Diarize && !job.IsMultiTrack && !job.StreamingMode {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No speaker information available for this transcription"})
		return
	}

	// Convert request to model
	var mappings []models.SpeakerMapping
	for _, mapping := range req.Mappings {
		mappings = append(mappings, models.SpeakerMapping{
			TranscriptionJobID: jobID,
			OriginalSpeaker:    mapping.OriginalSpeaker,
			CustomName:         mapping.CustomName,
		})
	}

	// Update mappings using repository
	if err := h.speakerMappingRepo.UpdateMappings(c.Request.Context(), jobID, mappings); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update speaker mappings"})
		return
	}

	// Fetch updated mappings to return
	updatedMappings, err := h.speakerMappingRepo.ListByJob(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch updated mappings"})
		return
	}

	// Convert to response format
	response := make([]SpeakerMappingResponse, len(updatedMappings))
	for i, mapping := range updatedMappings {
		response[i] = SpeakerMappingResponse{
			ID:              mapping.ID,
			OriginalSpeaker: mapping.OriginalSpeaker,
			CustomName:      mapping.CustomName,
		}
	}

	c.JSON(http.StatusOK, response)
}
