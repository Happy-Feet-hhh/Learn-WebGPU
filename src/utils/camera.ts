// 导入 wgpu-matrix 库的 mat4 矩阵工具和 Mat4 类型
// wgpu-matrix 是一个专为 WebGPU 设计的轻量级数学库，提供向量、矩阵运算
import { mat4, type Mat4 } from 'wgpu-matrix'

/**
 * Camera - 2D 正交相机
 *
 * 负责 2D 场景的投影和视图变换。
 * 使用正交投影（Orthographic Projection），不产生近大远小的透视效果，
 * 适合 2D 游戏渲染（如精灵、UI 元素等）。
 *
 * 坐标系统：
 *   - 原点 (0, 0) 在屏幕左上角
 *   - x 轴向右递增，y 轴向下递增
 *   - (width, height) 在屏幕右下角
 *   - 这种坐标系与屏幕像素坐标系一致，方便 2D 游戏开发
 */
export class Camera {
    // 投影矩阵：将世界坐标映射到标准化设备坐标（NDC，范围 -1 到 1）
    private projection!: Mat4;
    // 视图矩阵：定义相机的位置和朝向
    private view!: Mat4

    // 投影视图矩阵：projection × view 的乘积，作为 uniform 传入 GPU 着色器
    // 在顶点着色器中与每个顶点的位置相乘，完成坐标变换
    public projectionViewMatrix: Mat4;

    /**
     * @param width  - 视口宽度（像素），决定投影的水平范围
     * @param height - 视口高度（像素），决定投影的垂直范围
     */
    constructor(public width: number, public height: number) {
        // 初始化一个 4×4 单位矩阵
        this.projectionViewMatrix = mat4.create();
    }

    /**
     * 更新相机的投影和视图矩阵，并计算最终的投影视图矩阵。
     * 通常在每帧渲染前调用。
     */
    public update() {

        // 正交投影矩阵：
        //   mat4.ortho(left, right, bottom, top, near, far)
        //   - left=0, right=width：水平范围覆盖整个视口宽度
        //   - bottom=height, top=0：注意 bottom > top，使 y 轴向下为正，
        //     这使得 (0,0) 在左上角，(width,height) 在右下角，符合屏幕坐标系习惯
        //   - near=-1, far=1：近远裁剪面，2D 渲染中 z 值通常为 0，在此范围内即可
        this.projection = mat4.ortho(0, this.width, this.height, 0, -1, 1);

        // 视图矩阵（观察矩阵）：
        //   mat4.lookAt(eye, target, up)
        //   - eye=[0,0,1]：相机位于 z=1 的位置，沿 -z 方向观察（正交投影中 z 值不影响大小）
        //   - target=[0,0,0]：相机朝向原点（看向屏幕）
        //   - up=[0,1,0]：相机的上方向为 y 轴正方向
        //   对于 2D 渲染，这个设置相当于一个"俯视"屏幕的相机
        this.view = mat4.lookAt([0, 0, 1], [0, 0, 0], [0, 1, 0]);

        // 将投影矩阵和视图矩阵相乘，得到投影视图矩阵（Projection × View）
        // 这个组合矩阵将作为 uniform 传入着色器，避免每个顶点做两次矩阵乘法
        // 顶点着色器中：gl_Position = projectionViewMatrix * vec4(position, 0.0, 1.0)
        mat4.multiply(this.projection, this.view, this.projectionViewMatrix);
    }
}
