package app

import (
	"slices"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/x/mongo/driver/drivertest"
)

func TestParseUploadTargets(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  []string
	}{
		{"[]", []string{}},
		{`["\ud83d\ude00","�"]`, []string{"😀", "�"}},

		{"[]" + strings.Repeat(" ", multipartFieldLimit-2), []string{}},
		{` [ "two", "One", "two", "one", "résumé" ] `, []string{"two", "One", "one", "résumé"}},
	} {
		got, err := parseUploadTargets(strings.NewReader(tc.input))
		if err != nil || !slices.Equal(got, tc.want) {
			t.Errorf("got %v, %v; want %v", got, err, tc.want)
		}
	}
	for _, input := range []string{
		"", "null", "true", "{}", `"one"`, `[1]`, `[null]`, `[["one"]]`, `["one"] []`, `["one",]`,
		`[""]`, `["one ", "two"]`, `["\ud800"]`, `["\udc00"]`, `["all"]`, `["uncollected"]`, `["a/b"]`, `["\u0000"]`,
		"[\"\xff\"]", "[]" + strings.Repeat(" ", multipartFieldLimit-1),
	} {
		if _, err := parseUploadTargets(strings.NewReader(input)); err == nil {
			t.Errorf("accepted invalid input starting with %q", input[:min(len(input), 80)])
		}
	}
}

func TestUploadCommitAcknowledgement(t *testing.T) {
	lostAck := bson.D{
		{Key: "ok", Value: 1}, {Key: "n", Value: 1},
		{Key: "writeConcernError", Value: bson.M{"code": 64, "errmsg": "acknowledgement unavailable"}},
	}
	for _, tc := range []struct {
		name   string
		result bson.D
		want   string
	}{
		{"committed", bson.D{{Key: "ok", Value: 1}, {Key: "value", Value: bson.M{"state": "committed"}}}, "committed"},
		{"aborted", bson.D{{Key: "ok", Value: 1}, {Key: "value", Value: bson.M{"state": "aborting"}}}, "aborting"},
		{"unknown", bson.D{{Key: "ok", Value: 0}, {Key: "errmsg", Value: "database unavailable"}}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opts := options.Client().SetRetryWrites(false)
			opts.Deployment = drivertest.NewMockDeployment(lostAck, tc.result)
			client, err := mongo.Connect(opts)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Disconnect(t.Context())
			app := App{DB: client.Database("test_upload")}
			got, err := app.commitUpload(t.Context(), "op")
			if got != tc.want || (err != nil) != (tc.want == "") {
				t.Fatalf("got state %q, error %v; want %q", got, err, tc.want)
			}
		})
	}
}
