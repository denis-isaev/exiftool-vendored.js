import { exiftool } from '../exiftool'
import * as process from 'process'
import * as _fs from 'fs'
import * as _path from 'path'

const globule = require('globule')

function ellipsize(str: string, max: number) {
  return (str.length < max) ? str : str.substring(0, max - 1) + '…'
}

function usage() {
  console.log('Usage: `npm run mktags IMG_DIR`')
  console.log('\nRebuilds src/tags.ts from tags found in IMG_DIR.')
  process.exit(1)
}

const root = process.argv[2]
const files: string[] = globule.find(`${root}/**/*.jpg`)

if (files.length === 0) {
  console.error(`No files found in ${root}`)
  usage()
}

class Tag {
  values: any[] = []
  constructor(readonly tag: string) {
  } // tslint:disable-line

  get group(): string { return this.tag.split(':')[0] }
  get withoutGroup(): string { return this.tag.split(':')[1] }
  get valueType(): string {
    const n = this.withoutGroup
    if (n === 'DateStampMode') {
      return 'string'
    } else if (n.includes('DateStamp')) {
      return 'ExifDate'
    } else if (n.includes('TimeStamp')) {
      return 'ExifTime'
    } else if (n.includes('Date')) {
      return 'ExifDateTime'
    } else {
      return typeof this.values[0]
    }
  }
}
type GroupedTags = { [groupName: string]: Tag[] }

class TagMap {
  readonly map = new Map<string, Tag>()

  tag(tag: string) {
    const prevTag = this.map.get(tag)
    if (prevTag) {
      return prevTag
    } else {
      const t = new Tag(tag)
      this.map.set(tag, t)
      return t
    }
  }
  add(tag: string, value: any) {
    this.tag(tag).values.push(value)
  }
  tags(minValues: number = 10): Tag[] {
    return Array.from(this.map.values()).filter(a => a.values.length > minValues)
  }
  groupedTags(): GroupedTags {
    const groupedTags: GroupedTags = {}
    this.tags().forEach(tag => {
      const key = tag.group;
      (groupedTags[key] || (groupedTags[key] = [])).push(tag)
    })
    return groupedTags
  }
}

function cmp(a: any, b: any): number {
  return a > b ? 1 : a < b ? -1 : 0
}

const tagMap = new TagMap()

const saneTagRe = /^[a-z0-9_]+:[a-z0-9_]+$/i

Promise.all(files.map(file => {
  return exiftool.readGrouped(file).then((metadata: any) => {
    Object.keys(metadata).forEach(key => {
      if (saneTagRe.exec(key)) { tagMap.add(key, metadata[key]) }
    })
    process.stdout.write('.')
  }).catch(err => console.log(err))
})).then(() => {
  console.log(`\nRead ${tagMap.map.size} unique tags.`)
  const destFile = _path.resolve(__dirname, '../../src/tags.ts')
  const mdWriter = _fs.createWriteStream(destFile)
  mdWriter.write('// Autogenerated by `npm run mktags`\n')
  mdWriter.write('/* tslint:disable:class-name */\n')
  mdWriter.write(`import { ExifDate, ExifTime, ExifDateTime } from './datetime'\n`)
  const groupedTags = tagMap.groupedTags()
  const groupTagNames: string[] = []
  for (const group in groupedTags) {
    groupTagNames.push(group)
    mdWriter.write(`\nexport interface ${group}Tags {\n`)
    const tags = groupedTags[group].sort((a, b) => cmp(a.tag, b.tag))
    tags.forEach(tag =>
      mdWriter.write(`  ${tag.withoutGroup}: ${tag.valueType} // ${ellipsize(JSON.stringify(tag.values[0]), 80)}\n`)
    )
    mdWriter.write(`}\n`)
  }
  mdWriter.write('\n')
  mdWriter.write('export interface Tags extends\n')
  mdWriter.write(`  ${groupTagNames.map(s => s + 'Metadata').join(',\n  ')} {\n`)
  mdWriter.write('  SourceFile: string\n')
  mdWriter.write('  warnings: string[]\n')
  mdWriter.write('}\n')
  mdWriter.write('\n')
  mdWriter.write('export interface GroupedTags {\n')
  mdWriter.write('  SourceFile: string\n')
  mdWriter.write('  warnings: string[]\n')
  for (const group of groupTagNames) {
    mdWriter.write(`  ${group}: ${group}Tags\n`)
  }
  mdWriter.write('}\n')
  mdWriter.end()
  exiftool.end()
})