# 生成扩展图标 icons/icon{16,32,48,128}.png
# 纯标准库实现 PNG 编码，无需 Pillow。
# 图案：蓝色圆角方块 + 两个白色右指三角(快进符号)
import os, struct, zlib

BG = (59, 130, 246, 255)      # #3b82f6
FG = (255, 255, 255, 255)     # 白色


def in_rounded(x, y, n, r):
    # 整个画布为圆角矩形 [0, n-1]
    x0, y0, x1, y1 = 0, 0, n - 1, n - 1
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = x0 + r if x < x0 + r else (x1 - r if x > x1 - r else None)
    cy = y0 + r if y < y0 + r else (y1 - r if y > y1 - r else None)
    if cx is not None and cy is not None:
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return True


def sign(p, a, b):
    return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])


def in_tri(p, a, b, c):
    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def make(n):
    r = int(n * 0.22)
    # 两个三角形参数
    x1 = n * 0.24
    x2 = n * 0.76
    gap = n * 0.07
    tri_w = (x2 - x1 - gap) / 2.0
    ym = (n - 1) / 2.0
    th = n * 0.42  # 三角底边高
    yb0 = ym - th / 2.0
    yb1 = ym + th / 2.0
    # 左三角: 底在 x1, 顶在 x1+tri_w
    t1 = ((x1, yb0), (x1, yb1), (x1 + tri_w, ym))
    # 右三角: 底在 x1+tri_w+gap, 顶在 x2
    xb = x1 + tri_w + gap
    t2 = ((xb, yb0), (xb, yb1), (x2, ym))

    raw = bytearray()
    for y in range(n):
        raw.append(0)  # 过滤字节
        for x in range(n):
            p = (x, y)
            if in_tri(p, *t1) or in_tri(p, *t2):
                raw.extend(FG)
            elif in_rounded(x, y, n, r):
                raw.extend(BG)
            else:
                raw.extend((0, 0, 0, 0))

    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    os.makedirs(out_dir, exist_ok=True)
    for n in (16, 32, 48, 128):
        data = make(n)
        path = os.path.join(out_dir, "icon%d.png" % n)
        with open(path, "wb") as f:
            f.write(data)
        print("wrote", path, len(data), "bytes")


if __name__ == "__main__":
    main()
