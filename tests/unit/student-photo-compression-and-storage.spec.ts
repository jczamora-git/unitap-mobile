import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateImageFile,
  calculateTargetDimensions,
  formatFileSize,
  compressStudentPhoto,
  isWebpSupported,
} from '@/utilities/image-compression';
import { studentService, STUDENT_PHOTOS_BUCKET } from '@/services/student.service';
import { supabase } from '@/integrations/supabase/client';
import { DataModeService } from '@/services/data-mode.service';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

describe('UniTap 2.0 Student Profile Photo Compression & Storage Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    studentService.clearPhotoUrlCache();
  });

  describe('1. Client-Side Image Validation & Dimension Scaling', () => {
    it('validates supported image formats and rejects invalid types', () => {
      const validJpg = new File(['dummy'], 'avatar.jpg', { type: 'image/jpeg' });
      const validPng = new File(['dummy'], 'avatar.png', { type: 'image/png' });
      const validWebp = new File(['dummy'], 'avatar.webp', { type: 'image/webp' });
      const invalidPdf = new File(['dummy'], 'document.pdf', { type: 'application/pdf' });

      expect(validateImageFile(validJpg).valid).toBe(true);
      expect(validateImageFile(validPng).valid).toBe(true);
      expect(validateImageFile(validWebp).valid).toBe(true);

      const invalidRes = validateImageFile(invalidPdf);
      expect(invalidRes.valid).toBe(false);
      expect(invalidRes.error).toContain('Unsupported image format');
    });

    it('rejects oversized raw image files exceeding 15MB', () => {
      const oversizedBlob = {
        size: 16 * 1024 * 1024,
        type: 'image/jpeg',
      } as any;

      const res = validateImageFile(oversizedBlob);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Maximum supported file size is 15 MB');
    });

    it('correctly calculates target dimensions retaining aspect ratio under 640x640', () => {
      // Landscape: 1920x1080 -> 640x360
      const landscape = calculateTargetDimensions(1920, 1080, 640);
      expect(landscape.width).toBe(640);
      expect(landscape.height).toBe(360);

      // Portrait: 1080x1920 -> 360x640
      const portrait = calculateTargetDimensions(1080, 1920, 640);
      expect(portrait.width).toBe(360);
      expect(portrait.height).toBe(640);

      // Square: 1200x1200 -> 640x640
      const square = calculateTargetDimensions(1200, 1200, 640);
      expect(square.width).toBe(640);
      expect(square.height).toBe(640);

      // Small image under max: 400x300 -> retains 400x300 without upscale
      const small = calculateTargetDimensions(400, 300, 640);
      expect(small.width).toBe(400);
      expect(small.height).toBe(300);
    });

    it('formats file sizes accurately into human-readable units', () => {
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(85 * 1024)).toBe('85.0 KB');
      expect(formatFileSize(2.45 * 1024 * 1024)).toBe('2.45 MB');
    });
  });

  describe('2. Client-Side Image Compression Execution', () => {
    it('compresses photo with WebP/JPEG fallback and returns preview metrics', async () => {
      const dummyRawFile = new File(['sample image content for student photo testing'], 'photo.jpg', {
        type: 'image/jpeg',
      });

      const compressed = await compressStudentPhoto(dummyRawFile, 'student-uuid.webp');

      expect(compressed.file).toBeDefined();
      expect(compressed.blob).toBeDefined();
      expect(compressed.previewUrl).toBeDefined();
      expect(compressed.originalSize).toBe(dummyRawFile.size);
      expect(compressed.compressedSize).toBeGreaterThan(0);
      expect(['image/webp', 'image/jpeg']).toContain(compressed.mimeType);
      expect(compressed.width).toBeLessThanOrEqual(640);
      expect(compressed.height).toBeLessThanOrEqual(640);
    });
  });

  describe('3. Supabase Storage Upload, Upsert & Path Replacement', () => {
    it('uploads photo to student-profile-photos bucket with consistent UUID path and upsert', async () => {
      vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);

      const studentId = '00000000-0000-0000-0000-000000000001';
      const oldStoragePath = `${studentId}/profile_legacy_old.jpg`;
      const expectedNewPath = `${studentId}/profile.webp`;

      let uploadedPath = '';
      let uploadOptions: any = null;
      let removedPaths: string[] = [];
      let updatedPayload: any = null;

      // Mock Storage
      (supabase.storage.from as any) = vi.fn().mockImplementation((bucket: string) => {
        expect(bucket).toBe(STUDENT_PHOTOS_BUCKET);
        return {
          upload: vi.fn().mockImplementation((path: string, _file: any, options: any) => {
            uploadedPath = path;
            uploadOptions = options;
            return Promise.resolve({ data: { path }, error: null });
          }),
          remove: vi.fn().mockImplementation((paths: string[]) => {
            removedPaths = paths;
            return Promise.resolve({ data: paths, error: null });
          }),
          createSignedUrl: vi.fn().mockImplementation((path: string, _expiry: number) => {
            return Promise.resolve({
              data: { signedUrl: `https://mock.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=xyz` },
              error: null,
            });
          }),
        };
      });

      // Mock Database
      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { photo_storage_path: oldStoragePath },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => ({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                expect(col).toBe('id');
                expect(val).toBe(studentId);
                updatedPayload = payload;
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      const dummyCompressedBlob = new Blob(['compressed-binary-webp-data'], { type: 'image/webp' });
      const result = await studentService.uploadStudentPhoto(studentId, dummyCompressedBlob);

      // 1. Verify consistent UUID storage path
      expect(uploadedPath).toBe(expectedNewPath);
      expect(result.photoStoragePath).toBe(expectedNewPath);

      // 2. Verify upsert was enabled
      expect(uploadOptions?.upsert).toBe(true);

      // 3. Verify students table was updated with new photo_storage_path
      expect(updatedPayload).toBeDefined();
      expect(updatedPayload.photo_storage_path).toBe(expectedNewPath);

      // 4. Verify old legacy photo was removed ONLY AFTER upload and database update succeeded
      expect(removedPaths).toEqual([oldStoragePath]);

      // 5. Verify signed URL returned
      expect(result.photoUrl).toContain(expectedNewPath);
    });

    it('removes profile photo and clears storage path on deleteStudentPhoto', async () => {
      vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);

      const studentId = '00000000-0000-0000-0000-000000000002';
      const existingPath = `${studentId}/profile.webp`;

      let removedPaths: string[] = [];
      let updatedPayload: any = null;

      (supabase.storage.from as any) = vi.fn().mockImplementation(() => ({
        remove: vi.fn().mockImplementation((paths: string[]) => {
          removedPaths = paths;
          return Promise.resolve({ data: paths, error: null });
        }),
      }));

      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { photo_storage_path: existingPath },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockImplementation((payload: any) => ({
              eq: vi.fn().mockImplementation((_col: string, val: string) => {
                expect(val).toBe(studentId);
                updatedPayload = payload;
                return Promise.resolve({ error: null });
              }),
            })),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      await studentService.deleteStudentPhoto(studentId);

      expect(removedPaths).toEqual([existingPath]);
      expect(updatedPayload).toBeDefined();
      expect(updatedPayload.photo_storage_path).toBeNull();
    });
  });

  describe('4. NFC Scan Results Student Photo Verification', () => {
    it('resolves student photo in prepareNfcVerificationDirect for visual identity check', async () => {
      const { attendanceService } = await import('@/services/attendance.service');
      vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);

      const studentId = '00000000-0000-0000-0000-000000000003';
      const photoStoragePath = `${studentId}/profile.webp`;

      // Mock Occurrence
      (supabase.from as any) = vi.fn().mockImplementation((table: string) => {
        if (table === 'event_occurrences') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'occ-1',
                    status: 'OPEN',
                    checkpoints_json: [{ id: 'cp_in', label: 'Morning IN', type: 'IN' }],
                    active_checkpoint_id: 'cp_in',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'nfc_cards') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: 'card-1', uid_normalized: '04AABBCCDDEE', student_id: studentId, status: 'ACTIVE' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'students') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: studentId,
                    school_id: '2023-0001',
                    first_name: 'Maria',
                    last_name: 'Santos',
                    status: 'ACTIVE',
                    photo_storage_path: photoStoragePath,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'attendance_records') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      // Mock signed photo url
      (supabase.storage.from as any) = vi.fn().mockImplementation((bucket: string) => ({
        createSignedUrl: vi.fn().mockImplementation((path: string) => Promise.resolve({
          data: { signedUrl: `https://mock.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=abc` },
          error: null,
        })),
        createSignedUrls: vi.fn().mockImplementation((paths: string[]) => Promise.resolve({
          data: paths.map(p => ({
            path: p,
            signedUrl: `https://mock.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=abc`,
            error: null,
          })),
          error: null,
        })),
      }));

      const prep = await attendanceService.prepareNfcVerification(
        'occ-1',
        '04:AA:BB:CC:DD:EE',
        'officer-1',
        'cp_in'
      );

      expect(prep.type).toBe('ACCEPTED');
      expect(prep.eligible).toBe(true);
      expect(prep.studentFullName).toContain('Maria Santos');
      expect(prep.photoUrl).toBeDefined();
      expect(prep.photoUrl).toContain(photoStoragePath);
    });
  });
});
