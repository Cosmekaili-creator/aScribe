package realtime

import (
	"context"
	"fmt"
	"sync"
	"time"

	"ascribe/internal/config"
	"ascribe/internal/repository"
	"ascribe/internal/sse"
	"ascribe/pkg/logger"

	"github.com/google/uuid"
)

const (
	// idleTimeout is how long a session without audio activity is kept alive.
	idleTimeout = 5 * time.Minute
	// reaperInterval controls how often the reaper runs.
	reaperInterval = 60 * time.Second
)

// Manager keeps track of all active realtime sessions and creates new ones.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session

	jobRepo     repository.JobRepository
	broadcaster *sse.Broadcaster
	cfg         *config.Config
}

// NewManager constructs a Manager.  Call StartReaper to start background cleanup.
func NewManager(
	jobRepo repository.JobRepository,
	broadcaster *sse.Broadcaster,
	cfg *config.Config,
) *Manager {
	return &Manager{
		sessions:    make(map[string]*Session),
		jobRepo:     jobRepo,
		broadcaster: broadcaster,
		cfg:         cfg,
	}
}

// Create starts a new realtime session, spins up the ProviderClient, and
// returns the session.  Call session.Close() to terminate it.
func (m *Manager) Create(
	jobID string,
	userID uint,
	provider string,
	apiKey string,
	params map[string]any,
) (*Session, error) {
	sessionID := uuid.New().String()

	ctx, cancel := context.WithCancel(context.Background())

	var client ProviderClient
	switch provider {
	case "assemblyai":
		client = NewAssemblyAIClient()
	case "deepgram":
		client = NewDeepgramClient()
	default:
		cancel()
		return nil, fmt.Errorf("unknown provider: %q", provider)
	}

	sess := &Session{
		ID:             sessionID,
		JobID:          jobID,
		UserID:         userID,
		Provider:       provider,
		StartedAt:      time.Now(),
		LastSeen:       time.Now(),
		client:         client,
		cancel:         cancel,
		broadcaster:    m.broadcaster,
		jobRepo:        m.jobRepo,
		speakerCounter: make(map[string]int),
		lastFlush:      time.Now(),
	}

	// Start the upstream WS connection.
	events, err := client.Start(ctx, apiKey, params)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start %s stream: %w", provider, err)
	}

	// Consume events in the background.
	go sess.Run(ctx, events)

	m.mu.Lock()
	m.sessions[sessionID] = sess
	m.mu.Unlock()

	logger.Info("realtime: session created",
		"session_id", sessionID, "job_id", jobID, "provider", provider)
	return sess, nil
}

// Get looks up a session by its ID.
func (m *Manager) Get(sessionID string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	sess, ok := m.sessions[sessionID]
	return sess, ok
}

// Remove removes a session from the registry (and closes it if still open).
func (m *Manager) Remove(sessionID string) {
	m.mu.Lock()
	sess, ok := m.sessions[sessionID]
	if ok {
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()

	if ok {
		sess.Close()
		logger.Info("realtime: session removed", "session_id", sessionID)
	}
}

// Shutdown closes all active sessions.  Called on graceful server shutdown.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()

	for _, id := range ids {
		m.Remove(id)
	}
}

// StartReaper starts a goroutine that periodically closes sessions that have
// been idle for longer than idleTimeout.  Pass the server's root context.
func (m *Manager) StartReaper(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(reaperInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.reap()
			}
		}
	}()
}

func (m *Manager) reap() {
	now := time.Now()
	m.mu.RLock()
	var stale []string
	for id, sess := range m.sessions {
		sess.mu.Lock()
		idle := now.Sub(sess.LastSeen)
		sess.mu.Unlock()
		if idle > idleTimeout {
			stale = append(stale, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range stale {
		logger.Info("realtime: reaping idle session", "session_id", id)
		m.Remove(id)
	}
}
