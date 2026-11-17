package main

import (
	"fmt"
	"strings"
)

func main() {
	_ = strings.TrimSpace("x")
	// vet: fmt.Sprintf format %d has arg "three" of wrong type string
	_ = fmt.Sprintf("count: %d", "three")
}
