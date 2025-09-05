// 音频存储管理和监控 API 端点
import { z } from 'zod';
import { OpenAPIRoute, Str } from 'chanfana';
import { R2FileStorage } from '../store/r2/file-storage';
import { AppContext } from '../types';

/**
 * 音频存储统计信息端点
 * GET /api/audio-storage/stats
 */
export class AudioStorageStats extends OpenAPIRoute {
  schema = {
    tags: ['Audio Storage'],
    summary: '获取音频存储系统统计信息',
    description: '返回R2存储使用情况、文件数量等统计数据',
    responses: {
      '200': {
        description: '成功获取存储统计信息',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                totalFiles: z.number(),
                totalSizeBytes: z.number(),
                totalSizeMB: z.number(),
                formattedSize: z.string(),
                audioSessions: z.number(),
                lastUpdated: z.string()
              })
            })
          }
        }
      },
      '500': {
        description: '服务器内部错误'
      }
    }
  };

  async handle(c: AppContext) {
    try {
      const env = c.env;
      const r2Storage = new R2FileStorage(env.FRAPP_FILES_STORE);

      // 获取音频会话文件统计
      const audioSessionFiles = await r2Storage.listFiles({
        prefix: 'audio-sessions/',
        maxKeys: 1000
      });

      // 计算总大小
      const totalSize = audioSessionFiles.files.reduce((sum, file) => sum + file.size, 0);

      return c.json({
        success: true,
        data: {
          totalFiles: audioSessionFiles.files.length,
          totalSizeBytes: totalSize,
          totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
          formattedSize: formatBytes(totalSize),
          audioSessions: getUniqueSessionCount(audioSessionFiles.files),
          lastUpdated: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ Error getting audio storage stats:', error);
      return c.json({
        success: false,
        error: 'Failed to get storage statistics'
      }, 500);
    }
  }
}

/**
 * 用户音频文件列表端点  
 * GET /api/audio-storage/files/{userId}
 */
export class UserAudioFiles extends OpenAPIRoute {
  schema = {
    tags: ['Audio Storage'],
    summary: '获取指定用户的音频文件列表',
    description: '返回用户上传的所有音频会话文件',
    request: {
      params: z.object({
        userId: Str({ description: '用户ID' })
      }),
      query: z.object({
        limit: z.coerce.number().optional().default(50).describe('返回文件数量限制')
      })
    },
    responses: {
      '200': {
        description: '成功获取用户音频文件列表',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                userId: z.string(),
                files: z.array(z.object({
                  sessionId: z.string(),
                  filename: z.string(),
                  size: z.number(),
                  uploadedAt: z.string(),
                  chunkId: z.string().optional(),
                  chunkCount: z.string().optional()
                })),
                totalFiles: z.number(),
                totalSize: z.number()
              })
            })
          }
        }
      },
      '404': {
        description: '用户未找到'
      }
    }
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData();
      const { userId } = data.params;
      const { limit } = data.query;
      const env = c.env;

      const r2Storage = new R2FileStorage(env.FRAPP_FILES_STORE);

      // 获取用户的音频文件
      const userFiles = await r2Storage.listFiles({
        prefix: 'audio-sessions/',
        maxKeys: limit,
        userId: userId
      });

      // 即使没有找到文件也返回成功，只是文件列表为空
      if (userFiles.files.length === 0) {
        console.log(`No audio files found for user: ${userId}`);
        return c.json({
          success: true,
          data: {
            userId: userId,
            files: [],
            totalFiles: 0,
            totalSize: 0
          }
        });
      }

      // 解析文件信息
      const processedFiles = userFiles.files.map(file => ({
        sessionId: file.path.includes('session_') ?
          file.path.split('session_')[1]?.split('_chunk_')[0] || 'unknown' : 'unknown',
        filename: file.filename,
        size: file.size,
        uploadedAt: file.uploadedAt,
        chunkId: file.path.includes('_chunk_') ?
          file.path.split('_chunk_')[1]?.split('.')[0] : undefined,
        chunkCount: file.path.includes('_chunk_') ?
          'N/A' : undefined
      }));

      const totalSize = userFiles.files.reduce((sum, file) => sum + file.size, 0);

      return c.json({
        success: true,
        data: {
          userId,
          files: processedFiles,
          totalFiles: userFiles.files.length,
          totalSize
        }
      });

    } catch (error) {
      console.error('❌ Error getting user audio files:', error);
      return c.json({
        success: false,
        error: 'Failed to get user audio files'
      }, 500);
    }
  }
}

/**
 * 音频文件下载端点
 * GET /api/audio-storage/download/{filePath}
 */
export class DownloadAudioFile extends OpenAPIRoute {
  schema = {
    tags: ['Audio Storage'],
    summary: '下载音频文件',
    description: '下载指定的音频会话文件',
    request: {
      params: z.object({
        filePath: Str({ description: '文件路径' })
      })
    },
    responses: {
      '200': {
        description: '成功下载音频文件'
      },
      '404': {
        description: '文件未找到'
      }
    }
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData();
      const { filePath } = data.params;
      const env = c.env;

      const r2Storage = new R2FileStorage(env.FRAPP_FILES_STORE);

      // 安全检查：确保路径在audio-sessions目录下
      const safePath = filePath.startsWith('audio-sessions/') ?
        filePath : `audio-sessions/${filePath}`;

      const fileData = await r2Storage.downloadFile(safePath);

      if (!fileData) {
        return c.json({
          success: false,
          error: 'File not found'
        }, 404);
      }

      // 设置适当的响应头
      c.header('Content-Type', fileData.metadata.contentType || 'audio/wav');
      c.header('Content-Disposition', `attachment; filename="${fileData.metadata.filename}"`);
      c.header('Content-Length', fileData.data.byteLength.toString());

      return new Response(fileData.data);

    } catch (error) {
      console.error('❌ Error downloading audio file:', error);
      return c.json({
        success: false,
        error: 'Failed to download file'
      }, 500);
    }
  }
}

/**
 * 删除音频文件端点
 * DELETE /api/audio-storage/files/{filePath}
 */
export class DeleteAudioFile extends OpenAPIRoute {
  schema = {
    tags: ['Audio Storage'],
    summary: '删除音频文件',
    description: '删除指定的音频会话文件',
    request: {
      params: z.object({
        filePath: Str({ description: '文件路径' })
      })
    },
    responses: {
      '200': {
        description: '成功删除音频文件'
      },
      '404': {
        description: '文件未找到'
      }
    }
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData();
      console.log("data=====",data)
      const { filePath } = data.params;
      const env = c.env;

      const r2Storage = new R2FileStorage(env.FRAPP_FILES_STORE);

      // 安全检查：确保路径在audio-sessions目录下
      const safePath = filePath.startsWith('audio-sessions/') ?
        filePath : `audio-sessions/${filePath}`;

      const success = await r2Storage.deleteFile(safePath);

      if (!success) {
        return c.json({
          success: false,
          error: 'File not found or failed to delete'
        }, 404);
      }

      return c.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      console.error('❌ Error deleting audio file:', error);
      return c.json({
        success: false,
        error: 'Failed to delete file'
      }, 500);
    }
  }
}

/**
 * 清理过期音频文件端点
 * POST /api/audio-storage/cleanup
 */
export class CleanupExpiredFiles extends OpenAPIRoute {
  schema = {
    tags: ['Audio Storage'],
    summary: '清理过期的音频文件',
    description: '删除超过指定天数的音频会话文件',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              maxAgeDays: z.number().min(1).max(365).default(30)
            })
          }
        }
      }
    },
    responses: {
      '200': {
        description: '清理完成',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                deletedFiles: z.number(),
                freedSpaceBytes: z.number(),
                freedSpaceMB: z.number()
              })
            })
          }
        }
      }
    }
  };

  async handle(c: AppContext) {
    try {
      const body = await c.req.json();
      const { maxAgeDays = 30 } = body;
      const env = c.env;

      const r2Storage = new R2FileStorage(env.FRAPP_FILES_STORE);
      const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

      // 获取所有音频文件
      const allFiles = await r2Storage.listFiles({
        prefix: 'audio-sessions/',
        maxKeys: 1000
      });

      // 找出过期文件
      const expiredFiles = allFiles.files.filter(file => {
        const uploadedAt = new Date(file.uploadedAt);
        return uploadedAt < cutoffDate;
      });

      if (expiredFiles.length === 0) {
        return c.json({
          success: true,
          message: 'No expired files found',
          data: {
            deletedFiles: 0,
            freedSpaceBytes: 0,
            freedSpaceMB: 0
          }
        });
      }

      // 计算释放的空间
      const freedSpace = expiredFiles.reduce((sum, file) => sum + file.size, 0);

      // 批量删除过期文件
      const filePaths = expiredFiles.map(file => file.path);
      const deleteResults = await r2Storage.bulkDelete(filePaths);

      console.log(`🧹 Cleanup completed: ${deleteResults.deleted.length} files deleted, ${formatBytes(freedSpace)} freed`);

      return c.json({
        success: true,
        data: {
          deletedFiles: deleteResults.deleted.length,
          freedSpaceBytes: freedSpace,
          freedSpaceMB: Math.round(freedSpace / (1024 * 1024) * 100) / 100
        }
      });

    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      return c.json({
        success: false,
        error: 'Failed to cleanup expired files'
      }, 500);
    }
  }
}

// 辅助函数

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getUniqueSessionCount(files: any[]): number {
  const sessionIds = new Set<string>();
  files.forEach(file => {
    if (file.path.includes('session_')) {
      const sessionId = file.path.split('session_')[1]?.split('_chunk_')[0];
      if (sessionId) {
        sessionIds.add(sessionId);
      }
    }
  });
  return sessionIds.size;
}