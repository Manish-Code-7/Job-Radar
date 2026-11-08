# Nightly pg_dump of the Neon database → Cloudflare R2 (S3-compatible). Keeps the last 14 dumps.
# The client must match the server major version: Neon production runs Postgres 18.
FROM postgres:18-alpine
RUN apk add --no-cache aws-cli tzdata bash
ENV TZ=Asia/Kolkata
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh && echo "30 3 * * * /backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
CMD ["crond", "-f", "-l", "8"]
