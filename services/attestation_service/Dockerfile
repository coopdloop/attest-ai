FROM golang:1.25-alpine AS builder
WORKDIR /app
# Copy signing_service first — needed because go.mod has a local replace directive
COPY signing_service/ signing_service/
COPY attestation_service/go.mod attestation_service/go.sum* attestation_service/
WORKDIR /app/attestation_service
RUN go mod download
COPY attestation_service/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /attestation_service ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /attestation_service /attestation_service
EXPOSE 8082
ENTRYPOINT ["/attestation_service"]
