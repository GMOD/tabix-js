import { bench, describe } from 'vitest'

const sampleInfoFields = [
  'AC=1;AF=0.5;AN=2;DP=100;END=12345;MQ=60;NS=2',
  'SVTYPE=TRA;CHR2=chr2;END=54321;CT=3to5',
  'IMPRECISE;SVTYPE=DEL;END=10000;SVLEN=-500;CIPOS=-10,10',
  'END=5000;SVTYPE=INS;SVLEN=300;HOMLEN=10;HOMSEQ=ACGT',
  'DP=50;VDB=0.5;RPB=1.0;MQB=0.9;BQB=0.8;MQSB=0.85;SGB=-0.693147;MQ0F=0;END=8000',
  'SVTYPE=DUP;END=20000;SVLEN=1000;IMPRECISE;CIEND=-50,50',
  'AC=2;AF=1.0;AN=2;DP=200;END=15000;MQ=70;NS=3;DB',
  'INDEL;IDV=10;IMF=0.5;DP=100;VDB=0.8;RPB=0.9;END=7000',
]

describe('String comparison methods', () => {
  describe('SVTYPE=TRA detection', () => {
    bench('using includes()', () => {
      for (const info of sampleInfoFields) {
        const isTRA = info.includes('SVTYPE=TRA')
        if (isTRA) {
          // do something
        }
      }
    })

    bench('using character-by-character comparison', () => {
      for (const info of sampleInfoFields) {
        let prevChar = ';'
        let isTRA = false
        for (let j = 0; j < info.length; j += 1) {
          if (
            prevChar === ';' &&
            info[j] === 'S' &&
            info[j + 1] === 'V' &&
            info[j + 2] === 'T' &&
            info[j + 3] === 'Y' &&
            info[j + 4] === 'P' &&
            info[j + 5] === 'E' &&
            info[j + 6] === '=' &&
            info[j + 7] === 'T' &&
            info[j + 8] === 'R' &&
            info[j + 9] === 'A'
          ) {
            isTRA = true
            break
          }
          prevChar = info[j]
        }
        if (isTRA) {
          // do something
        }
      }
    })
  })

  describe('END= detection', () => {
    bench('using slice() comparison', () => {
      for (const info of sampleInfoFields) {
        let prevChar = ';'
        let endCoordinate = 0
        for (let j = 0; j < info.length; j += 1) {
          if (prevChar === ';' && info.slice(j, j + 4) === 'END=') {
            let valueEnd = info.indexOf(';', j)
            if (valueEnd === -1) {
              valueEnd = info.length
            }
            endCoordinate = Number.parseInt(info.slice(j + 4, valueEnd), 10)
            break
          }
          prevChar = info[j]
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('using character-by-character comparison', () => {
      for (const info of sampleInfoFields) {
        let prevChar = ';'
        let endCoordinate = 0
        for (let j = 0; j < info.length; j += 1) {
          if (
            prevChar === ';' &&
            info[j] === 'E' &&
            info[j + 1] === 'N' &&
            info[j + 2] === 'D' &&
            info[j + 3] === '='
          ) {
            let valueEnd = info.indexOf(';', j)
            if (valueEnd === -1) {
              valueEnd = info.length
            }
            endCoordinate = Number.parseInt(info.slice(j + 4, valueEnd), 10)
            break
          }
          prevChar = info[j]
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('using indexOf()', () => {
      for (const info of sampleInfoFields) {
        let endCoordinate = 0
        let pos = info.indexOf(';END=')
        if (pos === -1 && info.startsWith('END=')) {
          pos = -1
          const valueEnd = info.indexOf(';')
          endCoordinate = Number.parseInt(
            info.slice(4, valueEnd === -1 ? info.length : valueEnd),
            10,
          )
        } else if (pos !== -1) {
          pos += 1
          let valueEnd = info.indexOf(';', pos + 4)
          if (valueEnd === -1) {
            valueEnd = info.length
          }
          endCoordinate = Number.parseInt(info.slice(pos + 4, valueEnd), 10)
        }
        if (endCoordinate) {
          // do something
        }
      }
    })
  })

  describe('Combined scenario (realistic _getVcfEnd)', () => {
    bench('original approach with includes + slice', () => {
      for (const info of sampleInfoFields) {
        const startCoordinate = 1000
        const refSeq = 'ACGT'
        let endCoordinate = startCoordinate + refSeq.length

        const isTRA = info.includes('SVTYPE=TRA')
        if (info[0] !== '.' && !isTRA) {
          let prevChar = ';'
          for (let j = 0; j < info.length; j += 1) {
            if (prevChar === ';' && info.slice(j, j + 4) === 'END=') {
              let valueEnd = info.indexOf(';', j)
              if (valueEnd === -1) {
                valueEnd = info.length
              }
              endCoordinate = Number.parseInt(info.slice(j + 4, valueEnd), 10)
              break
            }
            prevChar = info[j]
          }
        } else if (isTRA) {
          endCoordinate = startCoordinate + 1
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('current approach with includes + character comparison', () => {
      for (const info of sampleInfoFields) {
        const startCoordinate = 1000
        const refSeq = 'ACGT'
        let endCoordinate = startCoordinate + refSeq.length

        const isTRA = info.includes('SVTYPE=TRA')
        if (info[0] !== '.' && !isTRA) {
          let prevChar = ';'
          for (let j = 0; j < info.length; j += 1) {
            if (
              prevChar === ';' &&
              info[j] === 'E' &&
              info[j + 1] === 'N' &&
              info[j + 2] === 'D' &&
              info[j + 3] === '='
            ) {
              let valueEnd = info.indexOf(';', j)
              if (valueEnd === -1) {
                valueEnd = info.length
              }
              endCoordinate = Number.parseInt(info.slice(j + 4, valueEnd), 10)
              break
            }
            prevChar = info[j]
          }
        } else if (isTRA) {
          endCoordinate = startCoordinate + 1
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('using includes + indexOf', () => {
      for (const info of sampleInfoFields) {
        const startCoordinate = 1000
        const refSeq = 'ACGT'
        let endCoordinate = startCoordinate + refSeq.length

        const isTRA = info.includes('SVTYPE=TRA')
        if (info[0] !== '.' && !isTRA) {
          let pos = info.indexOf(';END=')
          if (pos === -1 && info.startsWith('END=')) {
            const valueEnd = info.indexOf(';')
            endCoordinate = Number.parseInt(
              info.slice(4, valueEnd === -1 ? info.length : valueEnd),
              10,
            )
          } else if (pos !== -1) {
            pos += 1
            let valueEnd = info.indexOf(';', pos + 4)
            if (valueEnd === -1) {
              valueEnd = info.length
            }
            endCoordinate = Number.parseInt(info.slice(pos + 4, valueEnd), 10)
          }
        } else if (isTRA) {
          endCoordinate = startCoordinate + 1
        }
        if (endCoordinate) {
          // do something
        }
      }
    })
  })
})
