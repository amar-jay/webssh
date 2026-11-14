package agent

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GrantVerifier validates short-lived attach grants minted by the control plane.
type GrantVerifier struct {
	AgentID  string
	GrantKey string

	mu     sync.Mutex
	nonces map[string]int64
}

func NewGrantVerifier(agentID, grantKey string) *GrantVerifier {
	return &GrantVerifier{AgentID: agentID, GrantKey: grantKey, nonces: make(map[string]int64)}
}

func (v *GrantVerifier) Verify(token string, now time.Time) (sessionID string, err error) {
	if v == nil || v.GrantKey == "" || v.AgentID == "" {
		return "", errors.New("grant verifier unavailable")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 5 || parts[0] != "v1" {
		return "", errors.New("invalid grant")
	}
	sessionID = parts[1]
	if sessionID == "" || strings.ContainsAny(sessionID, ".\n") {
		return "", errors.New("invalid grant")
	}
	expUnix, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || expUnix <= 0 {
		return "", errors.New("invalid grant expiry")
	}
	nonce := parts[3]
	if nonce == "" || strings.ContainsAny(nonce, ".\n") {
		return "", errors.New("invalid grant")
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		return "", errors.New("invalid grant mac")
	}
	if now.Unix() >= expUnix || expUnix > now.Unix()+60 {
		return "", errors.New("grant expired")
	}
	message := "v1\n" + v.AgentID + "\n" + sessionID + "\n" + parts[2] + "\n" + nonce
	sum := hmac.New(sha256.New, []byte(v.GrantKey))
	_, _ = sum.Write([]byte(message))
	expected := sum.Sum(nil)
	if !hmac.Equal(mac, expected) {
		return "", errors.New("grant unauthorized")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	v.pruneLocked(now.Unix())
	if _, seen := v.nonces[nonce]; seen {
		return "", errors.New("grant replayed")
	}
	if len(v.nonces) >= 4096 {
		return "", errors.New("grant capacity exhausted")
	}
	v.nonces[nonce] = expUnix
	return sessionID, nil
}

func (v *GrantVerifier) pruneLocked(now int64) {
	for nonce, exp := range v.nonces {
		if exp < now {
			delete(v.nonces, nonce)
		}
	}
}

// EncodeGrant builds a grant string for tests. Production minting is server-side.
func EncodeGrant(agentID, grantKey, sessionID, nonce string, expUnix int64) string {
	msg := "v1\n" + agentID + "\n" + sessionID + "\n" + strconv.FormatInt(expUnix, 10) + "\n" + nonce
	sum := hmac.New(sha256.New, []byte(grantKey))
	_, _ = sum.Write([]byte(msg))
	mac := base64.RawURLEncoding.EncodeToString(sum.Sum(nil))
	return "v1." + sessionID + "." + strconv.FormatInt(expUnix, 10) + "." + nonce + "." + mac
}
