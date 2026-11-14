//go:build !linux && !darwin

package credentials

import "errors"

func Lock(string) (func(), error) {
	return nil, errors.New("credential recovery currently requires Linux or macOS")
}
