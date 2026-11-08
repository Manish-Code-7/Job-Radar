#!/usr/bin/env bash
set -euo pipefail
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
FILE="jobradar-$(date +%Y%m%d-%H%M).dump"
# Custom format, compressed. raw_payloads is short-lived debug data — skip it to keep dumps small.
pg_dump --format=custom --compress=9 --exclude-table-data=raw_payloads -f "/tmp/$FILE"
aws s3 cp "/tmp/$FILE" "s3://${R2_BUCKET}/backups/$FILE" --endpoint-url "$ENDPOINT" --only-show-errors
rm -f "/tmp/$FILE"
# Retention: keep the newest 14.
aws s3 ls "s3://${R2_BUCKET}/backups/" --endpoint-url "$ENDPOINT" | awk '{print $4}' | sort | head -n -14 | while read -r old; do
  [ -n "$old" ] && aws s3 rm "s3://${R2_BUCKET}/backups/$old" --endpoint-url "$ENDPOINT" --only-show-errors
done
echo "backup ok: $FILE"
