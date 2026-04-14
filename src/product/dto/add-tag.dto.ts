import { IsString, Length } from 'class-validator';

export class AddTagDto {
  @IsString()
  @Length(2, 30)
  name: string;
}
