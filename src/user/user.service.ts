import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UserService {
    constructor(private prisma: PrismaService) { }

    create(createUserDto: CreateUserDto) {
        return this.prisma.user.create({ data: createUserDto })
    } // create user

    findAll() {
        return this.prisma.user.findMany();
    }// get all user

    findOne(id: number) {
        const user = this.prisma.user.findUnique({ where: { id: id }, select: { id: true, firstName: true, lastName: true, email: true, createdAt: true, updatedAt: true, password: false } })
        return user


    }// get user by id

    update(id: number, updateUserDto: UpdateUserDto) {
        return this.prisma.user.update({ where: { id }, data: updateUserDto })
    }//update user by id

    remove(id: number) {
        return this.prisma.user.delete({ where: { id } });
    }// delete user by number
}