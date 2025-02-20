import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.mjs';
import Hooks from '#hooks/all.hooks.mjs';
import Prisoner from '#models/prisoner.model.mjs';
import Rule from '#models/rule.model.mjs';

export default class Chapter extends Model {

  static init(sequelize) {
    return super.init(
      Schemas.chapter,
                    {
                        sequelize,
                        hooks: Hooks.chapter || null,
                        modelName: 'Chapter'
                    }
            );
      }

  static associate(models) {
    //TODO: Has many prisoners
  }

  //Create
  static async createChapter( { name, location })  {
    return await this.create({ name, location });
}
  static async createBulkChapters(chapterArray) {
    return await this.bulkCreate(chapterArray, {individualHooks:true, ignoreDuplicates: true})
  }

  //Read
  static async countChapters() {
    const {count} = await this.findAndCountAll();

    return count;
  }
  //TODO add pagination to this
  static async getAllChapters() {
    return await this.findAll({})
  }

  static async getChapterByID(id) {
    return await this.findOne({
      where: {id: id}
    })
  }

  //Update
  static async updateChapter(chapter) {
    return await this.update({...chapter}, {where: {id: chapter.id}});
  }

  //Delete
  static async deleteChapter(id) {
    return await this.destroy({where: {id: id}, force: true});
  }
}