import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './users.dto';

@ApiTags('admin/users')
@ApiBearerAuth()
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles('ADMIN', 'SUPPORT')
  @Get()
  list() {
    return this.users.list();
  }

  @Roles('ADMIN', 'SUPPORT')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Roles('ADMIN')
  @Post()
  invite(@Body() dto: CreateUserDto, @CurrentUser() aktor: RequestUser) {
    return this.users.invite(dto, aktor);
  }

  @Roles('ADMIN')
  @Post(':id/reinvite')
  reinvite(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.users.reinvite(id, aktor);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() aktor: RequestUser) {
    return this.users.update(id, dto, aktor);
  }

  @Roles('ADMIN')
  @Post(':id/deaktivieren')
  deaktivieren(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.users.deaktivieren(id, aktor);
  }

  @Roles('ADMIN')
  @Post(':id/reaktivieren')
  reaktivieren(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.users.reaktivieren(id, aktor);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() aktor: RequestUser) {
    return this.users.remove(id, aktor);
  }
}
