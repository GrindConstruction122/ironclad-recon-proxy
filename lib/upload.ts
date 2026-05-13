import { createBrowserClient } from '@supabase/ssr'

const supabase = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export interface UploadedFileRef {
  name: string
  size: number
  path: string      // Supabase storage path
  signedUrl: string // Temporary URL for server-side fetch
  mimeType: string
}

/**
 * Uploads a file to Supabase Storage and returns a signed URL.
 * Files are stored under {user_id}/{timestamp}-{filename}
 * Signed URL valid for 1 hour.
 */
export async function uploadFileToSupabase(file: File): Promise<UploadedFileRef> {
  const client = supabase()

  // Get current user
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError || !user) {
    throw new Error('Not authenticated. Please log in again.')
  }

  // Generate unique path: {user_id}/{timestamp}-{sanitized_filename}
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const timestamp = Date.now()
  const path = `${user.id}/${timestamp}-${sanitizedName}`

  // Upload to Supabase Storage
  const { error: uploadError } = await client.storage
    .from('bid-documents')
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    console.error('Supabase upload error:', uploadError)
    throw new Error(`Upload failed: ${uploadError.message}`)
  }

  // Generate signed URL (1 hour expiry)
  const { data: signedData, error: signedError } = await client.storage
    .from('bid-documents')
    .createSignedUrl(path, 3600)

  if (signedError || !signedData?.signedUrl) {
    console.error('Signed URL error:', signedError)
    throw new Error('Failed to generate file URL')
  }

  return {
    name: file.name,
    size: file.size,
    path,
    signedUrl: signedData.signedUrl,
    mimeType: file.type || 'application/octet-stream',
  }
}

/**
 * Deletes a file from Supabase Storage by path.
 */
export async function deleteFileFromSupabase(path: string): Promise<void> {
  const client = supabase()
  const { error } = await client.storage.from('bid-documents').remove([path])
  if (error) {
    console.error('Delete error:', error)
    throw new Error(`Delete failed: ${error.message}`)
  }
}