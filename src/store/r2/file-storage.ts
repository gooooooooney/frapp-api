// Cloudflare R2 File Storage - Native Worker API
// High-performance file CRUD operations using Cloudflare R2 native Worker API
// Optimized for Cloudflare Workers runtime environment

/**
 * File metadata interface
 */
export interface FileMetadata {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
  lastModified?: string;
  etag?: string;
  path: string;
  publicUrl?: string;
}

/**
 * File upload options
 */
export interface UploadOptions {
  filename: string;
  contentType: string;
  userId: string;
  folder?: string;
  isPublic?: boolean;
  metadata?: Record<string, string>;
}

/**
 * File list options
 */
export interface ListFilesOptions {
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
  userId?: string;
}

/**
 * R2 File Storage Adapter
 * Native Cloudflare Workers R2 API implementation
 * Optimized for maximum performance in Workers runtime
 */
export class R2FileStorage {
  private r2: R2Bucket;
  private bucketName: string;

  constructor(r2Bucket: R2Bucket, bucketName: string = 'frapp-files') {
    this.r2 = r2Bucket;
    this.bucketName = bucketName;
    console.log(`✅ R2FileStorage initialized for bucket: ${bucketName}`);
  }

  /**
   * Upload a file to R2 storage using native Worker API
   * @param fileData - File content as ArrayBuffer, Uint8Array, or string
   * @param options - Upload configuration
   * @returns File metadata
   */
  async uploadFile(fileData: ArrayBuffer | Uint8Array | string, options: UploadOptions): Promise<FileMetadata> {
    const fileId = this.generateFileId();
    const filePath = this.generateFilePath(fileId, options.filename, options.folder);
    
    const customMetadata: Record<string, string> = {
      'uploaded-by': options.userId,
      'uploaded-at': new Date().toISOString(),
      'original-filename': options.filename,
      ...options.metadata
    };

    try {
      // Use R2 native put method (most efficient for Workers)
      await this.r2.put(filePath, fileData, {
        httpMetadata: {
          contentType: options.contentType,
        },
        customMetadata
      });

      const fileSize = this.getDataSize(fileData);

      console.log(`📁 File uploaded: ${filePath} (${this.formatBytes(fileSize)})`);

      return {
        id: fileId,
        filename: options.filename,
        contentType: options.contentType,
        size: fileSize,
        uploadedBy: options.userId,
        uploadedAt: new Date().toISOString(),
        path: filePath,
        publicUrl: options.isPublic ? this.getPublicUrl(filePath) : undefined
      };

    } catch (error) {
      console.error('❌ File upload failed:', error);
      throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download a file from R2 storage using native Worker API
   * @param filePath - File path in R2
   * @returns File content and metadata
   */
  async downloadFile(filePath: string): Promise<{
    data: ArrayBuffer;
    metadata: FileMetadata;
  }> {
    try {
      const object = await this.r2.get(filePath);
      
      if (!object) {
        throw new Error(`File not found: ${filePath}`);
      }

      const data = await object.arrayBuffer();
      
      const metadata: FileMetadata = {
        id: this.extractFileId(filePath),
        filename: object.customMetadata?.['original-filename'] || this.extractFilename(filePath),
        contentType: object.httpMetadata?.contentType || 'application/octet-stream',
        size: object.size,
        uploadedBy: object.customMetadata?.['uploaded-by'] || 'unknown',
        uploadedAt: object.customMetadata?.['uploaded-at'] || object.uploaded.toISOString(),
        lastModified: object.uploaded.toISOString(),
        etag: object.etag,
        path: filePath
      };

      console.log(`📥 File downloaded: ${filePath} (${this.formatBytes(data.byteLength)})`);
      
      return { data, metadata };

    } catch (error) {
      console.error('❌ File download failed:', error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get file metadata without downloading content using native Worker API
   * @param filePath - File path in R2
   * @returns File metadata
   */
  async getFileMetadata(filePath: string): Promise<FileMetadata | null> {
    try {
      const object = await this.r2.head(filePath);
      
      if (!object) {
        return null;
      }

      return {
        id: this.extractFileId(filePath),
        filename: object.customMetadata?.['original-filename'] || this.extractFilename(filePath),
        contentType: object.httpMetadata?.contentType || 'application/octet-stream',
        size: object.size,
        uploadedBy: object.customMetadata?.['uploaded-by'] || 'unknown',
        uploadedAt: object.customMetadata?.['uploaded-at'] || object.uploaded.toISOString(),
        lastModified: object.uploaded.toISOString(),
        etag: object.etag,
        path: filePath
      };

    } catch (error) {
      console.error('❌ Get file metadata failed:', error);
      return null;
    }
  }

  /**
   * Delete a file from R2 storage using native Worker API
   * @param filePath - File path in R2
   * @returns Success boolean
   */
  async deleteFile(filePath: string): Promise<boolean> {
    try {
      await this.r2.delete(filePath);
      console.log(`🗑️ File deleted: ${filePath}`);
      return true;

    } catch (error) {
      console.error('❌ File deletion failed:', error);
      return false;
    }
  }

  /**
   * List files in R2 storage using native Worker API
   * @param options - List configuration
   * @returns File list with metadata
   */
  async listFiles(options: ListFilesOptions = {}): Promise<{
    files: FileMetadata[];
    continuationToken?: string;
    isTruncated: boolean;
  }> {
    try {
      const listResult = await this.r2.list({
        prefix: options.prefix,
        limit: options.maxKeys || 100,
        cursor: options.continuationToken
      });

      const files: FileMetadata[] = [];
      
      for (const object of listResult.objects) {
        // Filter by user if specified
        if (options.userId && object.customMetadata?.['uploaded-by'] !== options.userId) {
          continue;
        }

        files.push({
          id: this.extractFileId(object.key),
          filename: object.customMetadata?.['original-filename'] || this.extractFilename(object.key),
          contentType: object.httpMetadata?.contentType || 'application/octet-stream',
          size: object.size,
          uploadedBy: object.customMetadata?.['uploaded-by'] || 'unknown',
          uploadedAt: object.customMetadata?.['uploaded-at'] || object.uploaded.toISOString(),
          lastModified: object.uploaded.toISOString(),
          etag: object.etag,
          path: object.key
        });
      }

      console.log(`📋 Listed ${files.length} files (prefix: ${options.prefix || 'all'})`);

      return {
        files,
        continuationToken: listResult.truncated ? 'has-more' : undefined,
        isTruncated: listResult.truncated
      };

    } catch (error) {
      console.error('❌ List files failed:', error);
      throw new Error(`Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update a file by uploading new content (same as upload with same path)
   * @param filePath - File path in R2
   * @param fileData - New file content
   * @param options - Upload options
   * @returns Updated file metadata
   */
  async updateFile(filePath: string, fileData: ArrayBuffer | Uint8Array | string, options: Partial<UploadOptions>): Promise<FileMetadata> {
    const existingMetadata = await this.getFileMetadata(filePath);
    
    if (!existingMetadata) {
      throw new Error(`File not found: ${filePath}`);
    }

    const customMetadata: Record<string, string> = {
      'uploaded-by': existingMetadata.uploadedBy,
      'uploaded-at': existingMetadata.uploadedAt,
      'original-filename': existingMetadata.filename,
      'updated-at': new Date().toISOString(),
      ...options.metadata
    };

    try {
      await this.r2.put(filePath, fileData, {
        httpMetadata: {
          contentType: options.contentType || existingMetadata.contentType,
        },
        customMetadata
      });

      const fileSize = this.getDataSize(fileData);

      console.log(`📝 File updated: ${filePath} (${this.formatBytes(fileSize)})`);

      return {
        id: existingMetadata.id,
        filename: existingMetadata.filename,
        contentType: options.contentType || existingMetadata.contentType,
        size: fileSize,
        uploadedBy: existingMetadata.uploadedBy,
        uploadedAt: existingMetadata.uploadedAt,
        lastModified: new Date().toISOString(),
        path: filePath,
        publicUrl: options.isPublic ? this.getPublicUrl(filePath) : existingMetadata.publicUrl
      };

    } catch (error) {
      console.error('❌ File update failed:', error);
      throw new Error(`Failed to update file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a file exists using native Worker API
   * @param filePath - File path in R2
   * @returns Boolean indicating existence
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const object = await this.r2.head(filePath);
      return object !== null;
    } catch {
      return false;
    }
  }

  // Helper methods

  private getDataSize(data: ArrayBuffer | Uint8Array | string): number {
    if (typeof data === 'string') {
      return new TextEncoder().encode(data).length;
    } else if (data instanceof ArrayBuffer) {
      return data.byteLength;
    } else {
      return data.length;
    }
  }

  private generateFileId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  private generateFilePath(fileId: string, filename: string, folder?: string): string {
    const sanitizedFilename = this.sanitizeFilename(filename);
    const extension = this.getFileExtension(sanitizedFilename);
    const basePath = folder ? `${folder}/${fileId}` : fileId;
    return `${basePath}${extension}`;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  private extractFileId(filePath: string): string {
    const parts = filePath.split('/');
    const filename = parts[parts.length - 1];
    return filename.split('.')[0]; // Remove extension
  }

  private extractFilename(filePath: string): string {
    return filePath.split('/').pop() || filePath;
  }

  private getPublicUrl(filePath: string): string {
    // Replace with your R2 public domain if configured
    return `https://pub-abc123.r2.dev/${filePath}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get storage statistics
   * @returns Storage usage information
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    formattedSize: string;
  }> {
    try {
      const { files } = await this.listFiles({ maxKeys: 1000 });
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);

      return {
        totalFiles: files.length,
        totalSize,
        formattedSize: this.formatBytes(totalSize)
      };

    } catch (error) {
      console.error('❌ Get storage stats failed:', error);
      return {
        totalFiles: 0,
        totalSize: 0,
        formattedSize: '0 B'
      };
    }
  }

  /**
   * Bulk delete files
   * @param filePaths - Array of file paths to delete
   * @returns Results of deletion operations
   */
  async bulkDelete(filePaths: string[]): Promise<{
    deleted: string[];
    failed: string[];
  }> {
    const results = { deleted: [] as string[], failed: [] as string[] };

    for (const filePath of filePaths) {
      const success = await this.deleteFile(filePath);
      if (success) {
        results.deleted.push(filePath);
      } else {
        results.failed.push(filePath);
      }
    }

    console.log(`🗑️ Bulk delete: ${results.deleted.length} deleted, ${results.failed.length} failed`);
    return results;
  }

  /**
   * Copy a file from one location to another
   * @param sourcePath - Source file path
   * @param destinationPath - Destination file path
   * @returns Success boolean
   */
  async copyFile(sourcePath: string, destinationPath: string): Promise<boolean> {
    try {
      const { data, metadata } = await this.downloadFile(sourcePath);
      
      await this.r2.put(destinationPath, data, {
        httpMetadata: {
          contentType: metadata.contentType,
        },
        customMetadata: {
          'uploaded-by': metadata.uploadedBy,
          'uploaded-at': metadata.uploadedAt,
          'original-filename': metadata.filename,
          'copied-from': sourcePath,
          'copied-at': new Date().toISOString()
        }
      });

      console.log(`📄 File copied: ${sourcePath} → ${destinationPath}`);
      return true;

    } catch (error) {
      console.error('❌ File copy failed:', error);
      return false;
    }
  }
}