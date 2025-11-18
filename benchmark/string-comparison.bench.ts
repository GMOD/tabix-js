import { bench, describe } from 'vitest'

const garbageFields =
  'DUMMY1=value1;DUMMY2=value2;DUMMY3=value3;DUMMY4=value4;DUMMY5=value5;' +
  'DUMMY6=value6;DUMMY7=value7;DUMMY8=value8;DUMMY9=value9;DUMMY10=value10;' +
  'DUMMY11=value11;DUMMY12=value12;DUMMY13=value13;DUMMY14=value14;DUMMY15=value15;' +
  'DUMMY16=value16;DUMMY17=value17;DUMMY18=value18;DUMMY19=value19;DUMMY20=value20;' +
  'DUMMY21=value21;DUMMY22=value22;DUMMY23=value23;DUMMY24=value24;DUMMY25=value25;' +
  'DUMMY26=value26;DUMMY27=value27;DUMMY28=value28;DUMMY29=value29;DUMMY30=value30;' +
  'DUMMY31=value31;DUMMY32=value32;DUMMY33=value33;DUMMY34=value34;DUMMY35=value35;' +
  'DUMMY36=value36;DUMMY37=value37;DUMMY38=value38;DUMMY39=value39;DUMMY40=value40'

const sampleInfoFields = [
  'AC=1;AF=0.5;AN=2;DP=100;END=12345;MQ=60;NS=2;' + garbageFields,
  'SVTYPE=TRA;CHR2=chr2;END=54321;CT=3to5;' + garbageFields,
  'IMPRECISE;SVTYPE=DEL;END=10000;SVLEN=-500;CIPOS=-10,10;' + garbageFields,
  'END=5000;SVTYPE=INS;SVLEN=300;HOMLEN=10;HOMSEQ=ACGT;' + garbageFields,
  'DP=50;VDB=0.5;RPB=1.0;MQB=0.9;BQB=0.8;MQSB=0.85;SGB=-0.693147;MQ0F=0;END=8000;' +
    garbageFields,
  'SVTYPE=DUP;END=20000;SVLEN=1000;IMPRECISE;CIEND=-50,50;' + garbageFields,
  'AC=2;AF=1.0;AN=2;DP=200;END=15000;MQ=70;NS=3;DB;' + garbageFields,
  'INDEL;IDV=10;IMF=0.5;DP=100;VDB=0.8;RPB=0.9;END=7000;' + garbageFields,
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

    bench('using includes() then indexOf()', () => {
      for (const info of sampleInfoFields) {
        let endCoordinate = 0
        if (info.includes(';END=') || info.startsWith('END=')) {
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
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('using regex (cached)', () => {
      const endRegex = /(?:^|;)END=([^;]+)/
      for (const info of sampleInfoFields) {
        let endCoordinate = 0
        const match = endRegex.exec(info)
        if (match) {
          endCoordinate = Number.parseInt(match[1], 10)
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('using regex (created each iteration)', () => {
      for (const info of sampleInfoFields) {
        let endCoordinate = 0
        const endRegex = /(?:^|;)END=([^;]+)/
        const match = endRegex.exec(info)
        if (match) {
          endCoordinate = Number.parseInt(match[1], 10)
        }
        if (endCoordinate) {
          // do something
        }
      }
    })
  })

  describe('Combined scenario (realistic _getVcfEnd)', () => {
    bench('includes for TRA + manual loop with slice', () => {
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

    bench('includes for TRA + manual loop with char-by-char', () => {
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

    bench('includes for TRA + indexOf for END', () => {
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

    bench('includes for TRA + includes guard + indexOf for END', () => {
      for (const info of sampleInfoFields) {
        const startCoordinate = 1000
        const refSeq = 'ACGT'
        let endCoordinate = startCoordinate + refSeq.length

        const isTRA = info.includes('SVTYPE=TRA')
        if (info[0] !== '.' && !isTRA) {
          if (info.includes(';END=') || info.startsWith('END=')) {
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
          }
        } else if (isTRA) {
          endCoordinate = startCoordinate + 1
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('includes for TRA + regex for END (cached)', () => {
      const endRegex = /(?:^|;)END=([^;]+)/
      for (const info of sampleInfoFields) {
        const startCoordinate = 1000
        const refSeq = 'ACGT'
        let endCoordinate = startCoordinate + refSeq.length

        const isTRA = info.includes('SVTYPE=TRA')
        if (info[0] !== '.' && !isTRA) {
          const match = endRegex.exec(info)
          if (match) {
            endCoordinate = Number.parseInt(match[1], 10)
          }
        } else if (isTRA) {
          endCoordinate = startCoordinate + 1
        }
        if (endCoordinate) {
          // do something
        }
      }
    })

    bench('includes for TRA + regex for END (created each iteration)', () => {
      for (const info of sampleInfoFields) {
        const startCoordinate = 1000
        const refSeq = 'ACGT'
        let endCoordinate = startCoordinate + refSeq.length

        const isTRA = info.includes('SVTYPE=TRA')
        if (info[0] !== '.' && !isTRA) {
          const endRegex = /(?:^|;)END=([^;]+)/
          const match = endRegex.exec(info)
          if (match) {
            endCoordinate = Number.parseInt(match[1], 10)
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
