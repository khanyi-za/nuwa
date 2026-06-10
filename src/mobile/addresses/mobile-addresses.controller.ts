import {
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileAddressesService } from './mobile-addresses.service';
import { CreateMobileAddressDto } from './dto/create-address.dto';
import { UpdateMobileAddressDto } from './dto/update-address.dto';

// All routes auth-required (global JwtAuthGuard; no @Public()).
@MobileController('api/me/addresses')
export class MobileAddressesController {
  constructor(private readonly service: MobileAddressesService) {}

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.service.list(userId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body() dto: CreateMobileAddressDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(userId, dto);
  }

  // Declared before :id so it isn't shadowed.
  @Patch(':id/default')
  setDefault(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.setDefault(userId, id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMobileAddressDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.remove(userId, id);
  }
}
