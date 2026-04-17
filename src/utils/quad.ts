// 导入 Vec2 类型：一个二维向量 [x, y]，来自 wgpu-matrix 数学库
import { type Vec2 } from "wgpu-matrix";

/**
 * Quad - 四边形类
 *
 * 用四个顶点（左上、右上、右下、左下）定义一个任意四边形。
 * 与 Rect 不同，Quad 的四个角可以不在轴对齐位置上，因此可以表示：
 *   - 旋转后的矩形
 *   - 扭曲/倾斜的四边形
 *   - 精灵的变换后形状
 *
 * 顶点顺序：左上 → 右上 → 右下 → 左下（顺时针或逆时针取决于坐标系），
 * 与 QuadGeometry 中的顶点顺序一致，用于索引缓冲区正确地构成两个三角形。
 */
export class Quad {
    /**
     * @param topLeft     - 左上角顶点坐标 [x, y]
     * @param topRight    - 右上角顶点坐标 [x, y]
     * @param bottomRight - 右下角顶点坐标 [x, y]
     * @param bottomLeft  - 左下角顶点坐标 [x, y]
     */
    constructor(
        public topLeft: Vec2,
        public topRight: Vec2,
        public bottomRight: Vec2,
        public bottomLeft: Vec2
    ) { }
}
