FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /go-api .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /go-api /go-api
EXPOSE 8080
ENTRYPOINT ["/go-api"]
