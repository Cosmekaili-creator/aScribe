package realtime

import (
	"fmt"
	"strings"
)

// normalizeSpeaker maps a raw provider label to the canonical
// "SPEAKER_NN" form used by WhisperX and throughout the transcript JSON.
//
// It returns the normalized label and a boolean indicating whether this
// was the first time the raw label was seen (i.e. a new speaker entry
// was added to counter).  The caller should use the bool to emit a
// realtime_speaker SSE event exactly once per unique speaker.
//
// Examples:
//
//	"A"         → ("SPEAKER_00", true on first call, false on subsequent)
//	"SPEAKER_0" → ("SPEAKER_00", true on first call, false on subsequent)
//	""          → ("SPEAKER_00", ...)
func normalizeSpeaker(raw string, counter map[string]int) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "0"
	}

	// Normalise the key we store in the counter.  For already-canonical
	// labels (e.g. "SPEAKER_01") keep them as-is so providers that already
	// return SPEAKER_NN form still get proper first-seen tracking.
	upper := strings.ToUpper(raw)

	if _, seen := counter[upper]; !seen {
		counter[upper] = len(counter)
		return fmt.Sprintf("SPEAKER_%02d", counter[upper]), true
	}
	return fmt.Sprintf("SPEAKER_%02d", counter[upper]), false
}
