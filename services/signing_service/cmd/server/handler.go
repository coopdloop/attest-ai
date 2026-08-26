package main

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/attest-ai/signing_service/internal/keystore"
	"github.com/attest-ai/signing_service/internal/signer"
	pb "github.com/attest-ai/signing_service/proto/signingpb"
)

// grpcHandler implements pb.SigningServiceServer.
type grpcHandler struct {
	pb.UnimplementedSigningServiceServer
	svc *signer.Service
}

func (h *grpcHandler) Sign(ctx context.Context, req *pb.SignRequest) (*pb.SignResponse, error) {
	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}
	if len(req.Digest) == 0 {
		return nil, status.Error(codes.InvalidArgument, "digest must not be empty")
	}

	keyID, sig, err := h.svc.Sign(ctx, req.OrgId, req.KeyId, req.Caller, req.Digest)
	if err != nil {
		if err == keystore.ErrKeyNotFound {
			return nil, status.Errorf(codes.NotFound, "no key found for org %s", req.OrgId)
		}
		return nil, status.Errorf(codes.Internal, "signing failed: %v", err)
	}

	return &pb.SignResponse{
		KeyId:     keyID,
		Signature: sig,
		SignedAt:  time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (h *grpcHandler) GetPublicKey(ctx context.Context, req *pb.GetPublicKeyRequest) (*pb.GetPublicKeyResponse, error) {
	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}

	kp, err := h.svc.GetPublicKey(ctx, req.OrgId, req.KeyId)
	if err != nil {
		if err == keystore.ErrKeyNotFound {
			return nil, status.Errorf(codes.NotFound, "no key found for org %s", req.OrgId)
		}
		return nil, status.Errorf(codes.Internal, "get public key failed: %v", err)
	}

	return &pb.GetPublicKeyResponse{
		KeyId:     kp.ID,
		PublicKey: kp.PublicKey,
		Algorithm: "Ed25519",
		CreatedAt: kp.CreatedAt.Format(time.RFC3339),
	}, nil
}

func (h *grpcHandler) RotateKey(ctx context.Context, req *pb.RotateKeyRequest) (*pb.RotateKeyResponse, error) {
	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}

	newID, oldID, err := h.svc.RotateKey(ctx, req.OrgId, req.Reason)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "key rotation failed: %v", err)
	}

	return &pb.RotateKeyResponse{
		NewKeyId:  newID,
		OldKeyId:  oldID,
		RotatedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}
