package signclient

import (
	"context"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/attest-ai/signing_service/proto/signingpb"
)

// Client wraps the gRPC connection to signing_service.
type Client struct {
	conn   *grpc.ClientConn
	client pb.SigningServiceClient
}

func New(addr string) (*Client, error) {
	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial signing_service at %s: %w", addr, err)
	}
	return &Client{conn: conn, client: pb.NewSigningServiceClient(conn)}, nil
}

func (c *Client) Close() {
	c.conn.Close()
}

func (c *Client) Sign(ctx context.Context, orgID, keyID, caller string, digest []byte) (string, []byte, error) {
	resp, err := c.client.Sign(ctx, &pb.SignRequest{
		OrgId:  orgID,
		KeyId:  keyID,
		Caller: caller,
		Digest: digest,
	})
	if err != nil {
		return "", nil, fmt.Errorf("Sign RPC: %w", err)
	}
	return resp.KeyId, resp.Signature, nil
}

func (c *Client) GetPublicKey(ctx context.Context, orgID, keyID string) ([]byte, error) {
	resp, err := c.client.GetPublicKey(ctx, &pb.GetPublicKeyRequest{
		OrgId: orgID,
		KeyId: keyID,
	})
	if err != nil {
		return nil, fmt.Errorf("GetPublicKey RPC: %w", err)
	}
	return resp.PublicKey, nil
}
