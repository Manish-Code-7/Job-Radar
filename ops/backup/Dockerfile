# Nightly pg_dump → Cloudflare R2 (S3-compatible). Keeps the last 14 dumps.
FROM alpine:3.20
RUN apk add --no-cache postgresql16-client aws-cli tzdata bash
ENV TZ=Asia/Kolkata
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh && echo "30 3 * * * /backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
