export function makeMediaStorageKey(input: {
  userId: string;
  tripId: string;
  clipId: string;
  fileName?: string;
}) {
  const fileName = input.fileName ?? `${input.clipId}.mp4`;
  return `users/${input.userId}/trips/${input.tripId}/clips/${fileName}`;
}

export function createPresignPlaceholder(storageKey: string) {
  return {
    storageKey,
    uploadUrl: null,
    method: "PUT",
    headers: {},
    expiresAt: null,
    note: "Storage provider is not configured yet. This placeholder reserves the API contract for direct uploads."
  };
}
