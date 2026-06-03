**@gmod/tabix**

***

# @gmod/tabix

## Classes

### CSI

#### Extends

- `default`

#### Constructors

##### Constructor

```ts
new CSI(args): CSI;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `args` | \{ `filehandle`: `GenericFilehandle`; \} |
| `args.filehandle` | `GenericFilehandle` |

###### Returns

[`CSI`](#csi)

###### Overrides

```ts
IndexFile.constructor
```

#### Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="filehandle"></a> `filehandle` | `public` | `GenericFilehandle` | `IndexFile.filehandle` |

***

### TabixIndexedFile

Reads Tabix-indexed files (bgzipped), supporting both .tbi and .csi index formats.

#### Constructors

##### Constructor

```ts
new TabixIndexedFile(__namedParameters): TabixIndexedFile;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | \{ `chunkCacheSize?`: `number`; `csiFilehandle?`: `GenericFilehandle`; `csiPath?`: `string`; `csiUrl?`: `string`; `filehandle?`: `GenericFilehandle`; `path?`: `string`; `tbiFilehandle?`: `GenericFilehandle`; `tbiPath?`: `string`; `tbiUrl?`: `string`; `url?`: `string`; \} |
| `__namedParameters.chunkCacheSize?` | `number` |
| `__namedParameters.csiFilehandle?` | `GenericFilehandle` |
| `__namedParameters.csiPath?` | `string` |
| `__namedParameters.csiUrl?` | `string` |
| `__namedParameters.filehandle?` | `GenericFilehandle` |
| `__namedParameters.path?` | `string` |
| `__namedParameters.tbiFilehandle?` | `GenericFilehandle` |
| `__namedParameters.tbiPath?` | `string` |
| `__namedParameters.tbiUrl?` | `string` |
| `__namedParameters.url?` | `string` |

###### Returns

[`TabixIndexedFile`](#tabixindexedfile)

#### Methods

##### bytesForRegions()

```ts
bytesForRegions(regions, opts?): Promise<number>;
```

Estimates the compressed byte size of the index chunks covering the given
regions. Useful for byte budgeting before issuing a `getLines` call to
decide whether a region is too large to fetch.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `regions` | `object`[] |
| `opts` | `Options` |

###### Returns

`Promise`\<`number`\>

##### getHeader()

```ts
getHeader(opts?): Promise<string>;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | `Options` |

###### Returns

`Promise`\<`string`\>

##### getHeaderBuffer()

```ts
getHeaderBuffer(opts?): Promise<Uint8Array<ArrayBufferLike>>;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | `Options` |

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

##### getLines()

```ts
getLines(
   refName, 
   s, 
   e, 
opts): Promise<void>;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `refName` | `string` | name of the reference sequence |
| `s` | `number` \| `undefined` | start of the region (0-based half-open) |
| `e` | `number` \| `undefined` | end of the region (0-based half-open) |
| `opts` | `GetLinesOpts` \| `GetLinesCallback` | callback invoked for each line, or an options object with `lineCallback` and optional `signal` |

###### Returns

`Promise`\<`void`\>

##### getReferenceSequenceNames()

```ts
getReferenceSequenceNames(opts?): Promise<string[]>;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | `Options` |

###### Returns

`Promise`\<`string`[]\>

##### lineCount()

```ts
lineCount(refName, opts?): Promise<number>;
```

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `refName` | `string` | reference sequence name |
| `opts` | `Options` | - |

###### Returns

`Promise`\<`number`\>

***

### TBI

#### Extends

- `default`

#### Constructors

##### Constructor

```ts
new TBI(__namedParameters): TBI;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `__namedParameters` | \{ `filehandle`: `GenericFilehandle`; \} |
| `__namedParameters.filehandle` | `GenericFilehandle` |

###### Returns

[`TBI`](#tbi)

###### Inherited from

```ts
IndexFile.constructor
```

#### Properties

| Property | Modifier | Type | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="filehandle-1"></a> `filehandle` | `public` | `GenericFilehandle` | `IndexFile.filehandle` |

***

### VirtualOffset

#### Constructors

##### Constructor

```ts
new VirtualOffset(blockPosition, dataPosition): VirtualOffset;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockPosition` | `number` |
| `dataPosition` | `number` |

###### Returns

[`VirtualOffset`](#virtualoffset)

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="blockposition"></a> `blockPosition` | `public` | `number` |
| <a id="dataposition"></a> `dataPosition` | `public` | `number` |

#### Methods

##### compareTo()

```ts
compareTo(b): number;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | [`VirtualOffset`](#virtualoffset) |

###### Returns

`number`

##### toString()

```ts
toString(): string;
```

###### Returns

`string`
