package pairing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientStartPollAndWait(t *testing.T) {
	var polls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/pairing/start":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"attemptId": "a1",
				"code":      "ABCD2345",
				"cliSecret": "secret",
				"expiresAt": 1,
				"url":       "https://example/pair?code=ABCD2345",
			})
		case "/api/pairing/poll":
			polls++
			if polls < 2 {
				_ = json.NewEncoder(w).Encode(map[string]string{"status": "pending"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{
				"status":      "completed",
				"agentId":     "agent",
				"agentToken":  "token",
				"grantKey":    "grant",
				"machineName": "box",
				"ownerId":     "42",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	client, err := NewClient(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	started, err := client.Start(context.Background(), "box")
	if err != nil || started.Code != "ABCD2345" {
		t.Fatalf("start: %+v %v", started, err)
	}
	file, err := client.Wait(context.Background(), started.Code, started.CLISecret)
	if err != nil {
		t.Fatal(err)
	}
	if file.AgentID != "agent" || file.OwnerID != "42" {
		t.Fatalf("wait: %+v", file)
	}
}

func TestClientPollUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "pairing_unauthorized"})
	}))
	defer srv.Close()
	client, err := NewClient(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = client.Poll(context.Background(), "ABCD2345", "nope")
	if err == nil || err.Error() != "pairing_unauthorized" {
		t.Fatalf("got %v", err)
	}
}

func TestNewClientRejectsPath(t *testing.T) {
	if _, err := NewClient("https://example.com/app"); err == nil {
		t.Fatal("expected origin path error")
	}
}
