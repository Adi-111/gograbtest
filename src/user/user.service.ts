import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UserService {
    constructor(private prisma: PrismaService) { }

    async create(createUserDto: CreateUserDto) {
        return await this.prisma.user.create({ data: createUserDto })
    } // create user
    async findAll() {
        return await this.prisma.user.findMany();
    }// get all user

    async findOne(id: number) {
        const user = await this.prisma.user.findUnique({ where: { id: id }, select: { id: true, firstName: true, lastName: true, email: true, createdAt: true, updatedAt: true, password: false } })
        return user


    }// get user by id

    async update(id: number, updateUserDto: UpdateUserDto) {
        return await this.prisma.user.update({ where: { id }, data: updateUserDto })
    }//update user by id

    async remove(id: number) {
        return await this.prisma.user.delete({ where: { id } });
    }// delete user by number
}