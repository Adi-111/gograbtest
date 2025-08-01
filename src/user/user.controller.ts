import { Body, Controller, Post, Get, Param, ParseIntPipe, Patch, Delete, UseGuards, Req, Logger } from "@nestjs/common";
import { ApiCreatedResponse, ApiTags, ApiOkResponse, ApiBearerAuth } from "@nestjs/swagger";
import { UserService } from "./user.service";
import { UserEntity } from "./entity/user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { AuthGuard } from "@nestjs/passport";



@Controller('users')
@ApiTags('users')
export class UserController {
    private readonly logger = new Logger(UserController.name);
    constructor(private readonly userService: UserService) { }

    @Post('post')
    @ApiCreatedResponse({ type: UserEntity })
    async create(@Body() createUserDto: CreateUserDto) {
        return new UserEntity(await this.userService.create(createUserDto));
    }

    @Get('getAllUsers')
    @ApiOkResponse({ type: UserEntity, isArray: true })
    async findAll() {
        const users = await this.userService.findAll();
        return users.map((user) => new UserEntity(user));
    }


    @ApiOkResponse({ type: UserEntity })
    @Get(':id')
    @ApiOkResponse({ type: UserEntity })
    async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        const user = await this.userService.findOne(id);
        this.logger.log(`user with email id: ${user.email} accessed his info.`)
        return new UserEntity(user);
    }

    @Patch(':id')
    @ApiCreatedResponse({ type: UserEntity })
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateUserDto: UpdateUserDto,
    ) {
        const user = new UserEntity(await this.userService.update(id, updateUserDto));
        return user;
    }

    @Delete(':id')
    @ApiOkResponse({ type: UserEntity })
    async remove(@Param('id', ParseIntPipe) id: number) {
        const user = new UserEntity(await this.userService.remove(id));
        user.password = '';
        return user;
    }

}