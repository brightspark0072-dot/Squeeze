// PDF password protection and removal, written for Squeeze (no external crypto library).
// Protect: AES-256 (PDF 2.0 / revision 6). Unlock: revisions 2,3,4 (RC4, AES-128) and 6 (AES-256).
// Needs a secure context (https or localhost) for WebCrypto.
(function () {
  const subtle = crypto.subtle;
  const enc = new TextEncoder();
  const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const le32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

  // ---------- AES via WebCrypto ----------
  async function aesEnc(key, iv, data, pad) {
    const k = await subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
    const out = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
    return pad ? out : out.slice(0, data.length);
  }
  async function aesDec(key, iv, data, nopad) {
    const k = await subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
    if (nopad) {
      // WebCrypto insists on padding: append the block that valid padding would produce.
      const last = data.slice(data.length - 16);
      const padBlock = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: last }, k, new Uint8Array(0)));
      data = cat(data, padBlock.slice(0, 16));
    }
    return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, k, data));
  }
  const sha = (alg, d) => subtle.digest(alg, d).then(b => new Uint8Array(b));

  // ---------- revision 6 password hash (ISO 32000-2, algorithm 2.B) ----------
  async function hash2B(pw, salt, udata) {
    let K = await sha('SHA-256', cat(pw, salt, udata));
    let i = 0, E;
    do {
      const K1 = cat(...Array(64).fill(cat(pw, K, udata)));
      E = await aesEnc(K.slice(0, 16), K.slice(16, 32), K1, false);
      let m = 0; for (let j = 0; j < 16; j++) m += E[j];
      K = await sha(['SHA-256', 'SHA-384', 'SHA-512'][m % 3], E);
      i++;
    } while (i < 64 || E[E.length - 1] > i - 32);
    return K.slice(0, 32);
  }
  const pwBytes = s => enc.encode(s || '').slice(0, 127);

  // ---------- MD5 and RC4 (needed to open older encrypted files) ----------
  function md5(m) {
    const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const n = m.length, tot = ((n + 8) >> 6) * 64 + 64, b = new Uint8Array(tot);
    b.set(m); b[n] = 0x80;
    const dv = new DataView(b.buffer); dv.setUint32(tot - 8, (n * 8) >>> 0, true); dv.setUint32(tot - 4, Math.floor(n / 536870912), true);
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let o = 0; o < tot; o += 64) {
      const M = new Int32Array(16); for (let i = 0; i < 16; i++) M[i] = dv.getInt32(o + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + K[i] + M[g]) | 0; A = D; D = C; C = B;
        const s = S[(i >> 4) * 4 + (i & 3)]; B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const out = new Uint8Array(16), ov = new DataView(out.buffer);
    ov.setInt32(0, a0, true); ov.setInt32(4, b0, true); ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
    return out;
  }
  function rc4(key, data) {
    const s = new Uint8Array(256); for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const o = new Uint8Array(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; o[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return o;
  }
  const PAD = new Uint8Array([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);
  const padPw = pw => { const b = pw.slice(0, 32); return cat(b, PAD.slice(0, 32 - b.length)); };

  // ---------- walking pdf-lib objects ----------
  function lib() { return window.PDFLib; }
  function isStr(v) { const L = lib(); return v instanceof L.PDFString || v instanceof L.PDFHexString; }
  async function mapStrings(obj, fn, seen) {
    const L = lib();
    if (obj instanceof L.PDFStream) obj = obj.dict;
    if (obj instanceof L.PDFDict) {
      for (const [k, v] of Array.from(obj.dict.entries())) {
        if (isStr(v)) obj.dict.set(k, L.PDFHexString.of(hex(await fn(v.asBytes()))));
        else if (v instanceof L.PDFDict || v instanceof L.PDFArray || v instanceof L.PDFStream) await mapStrings(v, fn);
      }
    } else if (obj instanceof L.PDFArray) {
      for (let i = 0; i < obj.array.length; i++) {
        const v = obj.array[i];
        if (isStr(v)) obj.array[i] = L.PDFHexString.of(hex(await fn(v.asBytes())));
        else if (v instanceof L.PDFDict || v instanceof L.PDFArray || v instanceof L.PDFStream) await mapStrings(v, fn);
      }
    }
  }
  function nameOf(v) { return v && v.asString ? v.asString().replace(/^\//, '') : null; }
  function numOf(v, d) { return v && typeof v.asNumber === 'function' ? v.asNumber() : d; }

  // ---------- Protect (AES-256) ----------
  async function protect(bytes, o) {
    const L = lib();
    const doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const ctx = doc.context;
    if (ctx.trailerInfo.Encrypt) throw new Error('This PDF is already protected. Unlock it first.');
    const userPw = pwBytes(o.user), ownerPw = pwBytes(o.owner || hex(rnd(12)));
    const fileKey = rnd(32);
    const zero = new Uint8Array(16);

    const vs = rnd(8), ks = rnd(8);
    const U = cat(await hash2B(userPw, vs, new Uint8Array(0)), vs, ks);
    const UE = await aesEnc(await hash2B(userPw, ks, new Uint8Array(0)), zero, fileKey, false);
    const vs2 = rnd(8), ks2 = rnd(8);
    const O = cat(await hash2B(ownerPw, vs2, U), vs2, ks2);
    const OE = await aesEnc(await hash2B(ownerPw, ks2, U), zero, fileKey, false);

    let flags = 0;
    if (o.allowPrint !== false) flags |= 4 | 2048;
    if (o.allowEdit !== false) flags |= 8 | 32 | 256 | 1024;
    if (o.allowCopy !== false) flags |= 16 | 512;
    else flags |= 512; // screen readers stay allowed
    const P = (0xFFFFF0C0 | flags) | 0;
    const permsPlain = cat(le32(P), new Uint8Array([255, 255, 255, 255]), enc.encode('Tadb'), rnd(4));
    const Perms = await aesEnc(fileKey, zero, permsPlain, false);

    const encrypt = async d => { const iv = rnd(16); return cat(iv, await aesEnc(fileKey, iv, d, true)); };

    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof L.PDFStream) {
        const dict = obj.dict;
        await mapStrings(dict, encrypt);
        const raw = obj.getContents();
        ctx.assign(ref, L.PDFRawStream.of(dict, await encrypt(raw)));
      } else if (obj instanceof L.PDFDict || obj instanceof L.PDFArray) {
        await mapStrings(obj, encrypt);
      } else if (isStr(obj)) {
        ctx.assign(ref, L.PDFHexString.of(hex(await encrypt(obj.asBytes()))));
      }
    }

    const cf = ctx.obj({ StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } });
    const eDict = ctx.obj({
      Filter: 'Standard', V: 5, R: 6, Length: 256, P,
      O: L.PDFHexString.of(hex(O)), U: L.PDFHexString.of(hex(U)),
      OE: L.PDFHexString.of(hex(OE)), UE: L.PDFHexString.of(hex(UE)), Perms: L.PDFHexString.of(hex(Perms)),
      CF: cf, StmF: 'StdCF', StrF: 'StdCF'
    });
    ctx.trailerInfo.Encrypt = ctx.register(eDict);
    if (!ctx.trailerInfo.ID) {
      const id = L.PDFHexString.of(hex(rnd(16)));
      ctx.trailerInfo.ID = ctx.obj([id, id]);
    }
    return await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  }

  // ---------- Unlock ----------
  function isEncrypted(doc) { return !!doc.context.trailerInfo.Encrypt; }

  async function unlock(bytes, password) {
    const L = lib();
    const doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const ctx = doc.context;
    const eRef = ctx.trailerInfo.Encrypt;
    if (!eRef) throw new Error('NOT_ENCRYPTED');
    const ed = ctx.lookup(eRef);
    const g = k => ed.get(L.PDFName.of(k));
    const bytesOf = k => { const v = ctx.lookup(g(k)); return v ? v.asBytes() : null; };
    const V = numOf(g('V'), 0), R = numOf(g('R'), 2);
    const filter = nameOf(g('Filter'));
    if (filter !== 'Standard') throw new Error('Unsupported protection type: ' + filter);
    const pw = pwBytes(password);
    let key = null, kind = 'rc4';

    if (R >= 5) {
      if (R === 5) throw new Error('This older AES-256 variant is not supported.');
      const O = bytesOf('O'), U = bytesOf('U'), OE = bytesOf('OE'), UE = bytesOf('UE');
      const zero = new Uint8Array(16);
      if (eq(await hash2B(pw, U.slice(32, 40), new Uint8Array(0)), U.slice(0, 32)))
        key = await aesDec(await hash2B(pw, U.slice(40, 48), new Uint8Array(0)), zero, UE, true);
      else if (eq(await hash2B(pw, O.slice(32, 40), U.slice(0, 48)), O.slice(0, 32)))
        key = await aesDec(await hash2B(pw, O.slice(40, 48), U.slice(0, 48)), zero, OE, true);
      kind = 'aes256';
    } else {
      const O = bytesOf('O'), U = bytesOf('U'), P = numOf(g('P'), 0) | 0;
      const idArr = ctx.trailerInfo.ID && ctx.lookup(ctx.trailerInfo.ID);
      const id0 = idArr && idArr.size() ? ctx.lookup(idArr.get(0)).asBytes() : new Uint8Array(0);
      const encMeta = !(g('EncryptMetadata') && g('EncryptMetadata').toString() === 'false');
      const n = R === 2 ? 5 : Math.max(5, Math.min(16, (numOf(g('Length'), 40)) / 8));
      const keyFor = userPad => {
        let h = md5(cat(userPad, O.slice(0, 32), le32(P), id0, (R >= 4 && !encMeta) ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)));
        if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
        return h.slice(0, n);
      };
      const checkUser = k => {
        if (R === 2) return eq(rc4(k, PAD), U.slice(0, 32));
        let h = md5(cat(PAD, id0)); h = rc4(k, h);
        for (let i = 1; i <= 19; i++) h = rc4(k.map(b => b ^ i), h);
        return eq(h, U.slice(0, 16));
      };
      let k = keyFor(padPw(pw));
      if (checkUser(k)) key = k;
      else { // maybe it is the owner password: recover the user password from /O
        let h = md5(padPw(pw)); if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
        const ok = h.slice(0, n); let up = O.slice(0, 32);
        if (R === 2) up = rc4(ok, up); else for (let i = 19; i >= 0; i--) up = rc4(ok.map(b => b ^ i), up);
        k = keyFor(up); if (checkUser(k)) key = k;
      }
      // which cipher?
      kind = 'rc4';
      if (V >= 4) {
        const cf = ctx.lookup(g('CF')), std = cf && ctx.lookup(cf.get(L.PDFName.of(nameOf(g('StmF')) || 'StdCF')));
        const m = std && nameOf(std.get(L.PDFName.of('CFM')));
        kind = m === 'AESV2' ? 'aes128' : (m === 'None' ? 'none' : 'rc4');
      }
    }
    if (!key) throw new Error('WRONG_PASSWORD');

    const objKey = async (ref) => {
      if (kind === 'aes256') return key;
      const extra = kind === 'aes128' ? enc.encode('sAlT') : new Uint8Array(0);
      const h = md5(cat(key, new Uint8Array([ref.objectNumber & 255, (ref.objectNumber >> 8) & 255, (ref.objectNumber >> 16) & 255, ref.generationNumber & 255, (ref.generationNumber >> 8) & 255]), extra));
      return h.slice(0, Math.min(key.length + 5, 16));
    };
    const decryptWith = async (k, d) => {
      if (kind === 'rc4') return rc4(k, d);
      if (d.length < 32) return d.length >= 16 ? new Uint8Array(0) : d;
      return aesDec(k, d.slice(0, 16), d.slice(16), false);
    };
    if (kind === 'none') throw new Error('Unsupported protection type');

    // Object streams are encrypted as a whole, and pdf-lib cannot read them while encrypted (it keeps them as
    // "invalid objects"). Cut each one out of the raw bytes, decrypt it, then unpack the objects inside.
    const inObjStm = new Set();
    for (const [ref, obj] of Array.from(ctx.enumerateIndirectObjects())) {
      let raw = null;
      if (obj instanceof L.PDFInvalidObject) raw = obj.data;
      else if (obj instanceof L.PDFStream && nameOf(obj.dict.get(L.PDFName.of('Type'))) === 'ObjStm') raw = { stream: obj };
      if (!raw) continue;
      let stream;
      if (raw.stream) stream = raw.stream;
      else {
        const txt = Array.from(raw, c => String.fromCharCode(c)).join('');
        if (!/\/ObjStm/.test(txt.slice(0, 200))) continue;
        const m = /stream\r?\n/.exec(txt); if (!m) continue;
        const len = +(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(txt) || [])[1];
        const start = m.index + m[0].length;
        const dictTxt = txt.slice(0, m.index);
        const dict = ctx.obj({ Type: 'ObjStm', N: +/\/N\s+(\d+)/.exec(dictTxt)[1], First: +/\/First\s+(\d+)/.exec(dictTxt)[1], Filter: 'FlateDecode' });
        stream = L.PDFRawStream.of(dict, raw.slice(start, start + len));
      }
      const plain = await decryptWith(await objKey(ref), stream.getContents());
      const rs = L.PDFRawStream.of(stream.dict, plain);
      L.PDFObjectStreamParser.forStream(rs).parseOffsetsAndObjectNumbers().forEach(x => inObjStm.add(x.objectNumber + ' 0 R'));
      await L.PDFObjectStreamParser.forStream(rs).parseIntoContext();
      ctx.delete(ref);
    }
    const encMetaFlag = !(g('EncryptMetadata') && g('EncryptMetadata').toString() === 'false');
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (ref === eRef || obj === ed || inObjStm.has(ref.toString())) continue;
      const k = await objKey(ref);
      const dec = d => decryptWith(k, d);
      if (obj instanceof L.PDFStream) {
        const t = nameOf(obj.dict.get(L.PDFName.of('Type')));
        if (t === 'XRef') continue;
        if (t === 'Metadata' && !encMetaFlag) { await mapStrings(obj.dict, dec); continue; }
        await mapStrings(obj.dict, dec);
        ctx.assign(ref, L.PDFRawStream.of(obj.dict, await dec(obj.getContents())));
      } else if (obj instanceof L.PDFDict || obj instanceof L.PDFArray) {
        await mapStrings(obj, dec);
      } else if (isStr(obj)) {
        ctx.assign(ref, L.PDFHexString.of(hex(await dec(obj.asBytes()))));
      }
    }
    ctx.delete(eRef);
    delete ctx.trailerInfo.Encrypt;
    return await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  }

  window.PDFCrypt = { protect, unlock, isEncryptedBytes: async b => !!(await lib().PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false })).context.trailerInfo.Encrypt };
})();
