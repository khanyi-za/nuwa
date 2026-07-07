import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SaleCampaignService } from './sale-campaign.service';
import { CreateSaleCampaignDto } from '../dto/create-sale-campaign.dto';

// Authz handled service-side via canManageStore + store-status check.
@Controller('stores/:storeId/sales')
export class SaleCampaignController {
  constructor(private readonly sales: SaleCampaignService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.sales.list(userId, storeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: CreateSaleCampaignDto,
  ) {
    return this.sales.create(userId, storeId, dto);
  }

  @Get(':campaignId')
  detail(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('campaignId') campaignId: string,
  ) {
    return this.sales.getDetail(userId, storeId, campaignId);
  }

  @Post(':campaignId/end')
  @HttpCode(HttpStatus.OK)
  end(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('campaignId') campaignId: string,
  ) {
    return this.sales.endCampaign(userId, storeId, campaignId);
  }
}
