package store

import (
	"bytes"
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// ObjectStore wraps S3/MinIO for trace blob storage.
type ObjectStore struct {
	client *s3.Client
	bucket string
}

func NewObjectStore(ctx context.Context, endpoint, bucket, accessKey, secretKey string) (*ObjectStore, error) {
	customResolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, opts ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               endpoint,
				HostnameImmutable: true,
			}, nil
		},
	)

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion("us-east-1"),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true // required for MinIO
	})

	// Ensure bucket exists
	_, err = client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)})
	if err != nil {
		// Ignore "already exists" error
	}

	return &ObjectStore{client: client, bucket: bucket}, nil
}

// PutObject stores blob data at the given key.
func (s *ObjectStore) PutObject(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	return err
}

// GetObject retrieves blob data at the given key.
func (s *ObjectStore) GetObject(ctx context.Context, key string) ([]byte, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()

	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(out.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// TraceEventKey returns the MinIO object key for a trace event blob.
func TraceEventKey(sessionID string, seq int64) string {
	return fmt.Sprintf("traces/%s/events/%08d.json", sessionID, seq)
}

// BundleKey returns the MinIO object key for an attestation bundle.
func BundleKey(sessionID string) string {
	return fmt.Sprintf("bundles/%s/attestation_bundle.json", sessionID)
}
