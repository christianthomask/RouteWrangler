import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { PresignRequestSchema, type PresignResponse } from '@routewrangler/contracts';
import { PhotosService } from './photos.service';

@Controller('photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  /** POST /photos/presign — event first, photo attaches async (BUILD_SPEC §9). */
  @Post('presign')
  presign(@Body() body: unknown): Promise<PresignResponse> {
    const parsed = PresignRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.photos.presign(parsed.data);
  }
}
