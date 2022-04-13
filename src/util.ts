export class Reader {
  offset = 0;
  LE: boolean;
  view: DataView;
  constructor(arrayBuffer: ArrayBuffer, LE = true) {
    this.view = new DataView(arrayBuffer);
    this.offset = 0;
    this.LE = LE;
  }

  skip = (bytes: number) => ((this.offset += bytes), this);

  readUint8 = () => this.view.getUint8(this.offset++);
  readUint16 = (LE?: boolean) => ((this.offset += 2), this.view.getUint16(this.offset - 2, LE ?? this.LE));
  readUint32 = (LE?: boolean) => ((this.offset += 4), this.view.getUint32(this.offset - 4, LE ?? this.LE));
  readInt8 = () => this.view.getInt8(this.offset++);
  readInt16 = (LE?: boolean) => ((this.offset += 2), this.view.getInt16(this.offset - 2, LE ?? this.LE));
  readInt32 = (LE?: boolean) => ((this.offset += 4), this.view.getInt32(this.offset - 4, LE ?? this.LE));
  readFloat32 = (LE?: boolean) => ((this.offset += 4), this.view.getFloat32(this.offset - 4, LE ?? this.LE));
  readFloat64 = (LE?: boolean) => ((this.offset += 8), this.view.getFloat64(this.offset - 8, LE ?? this.LE));
  readBytes = (length: number) => ((this.offset += length), this.view.buffer.slice(this.offset - length, this.offset));

  readString(unicode = false) {
    const method = unicode ? this.readUint16 : this.readUint8;

    let string = '';

    let charCode = method();
    while (charCode !== 0) {
      string += String.fromCharCode(charCode);
      charCode = method();
    }

    return string;
  }
}

export class Writer {
  view: DataView;
  offset: number;
  constructor(length: number, offset = 0) {
    this.view = new DataView(new ArrayBuffer(length));
    this.offset = offset;
  }

  skip = (bytes: number) => ((this.offset += bytes), this);

  writeUint8 = (value: number) => (this.view.setUint8(this.offset++, value), this);
  writeUint16 = (value: number) => ((this.offset += 2), this.view.setUint16(this.offset - 2, value, true), this);
  writeUint32 = (value: number) => ((this.offset += 4), this.view.setUint32(this.offset - 4, value, true), this);
  writeInt8 = (value: number) => (this.view.setInt8(this.offset++, value), this);
  writeInt16 = (value: number) => ((this.offset += 2), this.view.setInt16(this.offset - 2, value, true), this);
  writeInt32 = (value: number) => ((this.offset += 4), this.view.setInt32(this.offset - 4, value, true), this);
  writeFloat32 = (value: number) => ((this.offset += 4), this.view.setFloat32(this.offset - 4, value, true), this);
  writeFloat64 = (value: number) => ((this.offset += 8), this.view.setFloat64(this.offset - 8, value, true), this);

  writeString(string: string, unicode = false) {
    const method = unicode ? this.writeUint16 : this.writeUint8;

    Array.from(string).forEach(char => method(char.charCodeAt(0)));
    method(0);

    return this;
  }

  get raw() {
    return this.view;
  }
}
