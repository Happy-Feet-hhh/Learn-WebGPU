/**
 * PostProcessEffect - 后处理效果基础类
 *
 * 【后处理管线概述】
 * 后处理（Post-Processing）是图形学中一种在场景渲染完成之后，对最终图像进行进一步处理的 technique。
 * 基本流程是：
 *   1. 先将 3D 场景渲染到一个离屏纹理（Off-screen Texture），而不是直接输出到屏幕
 *   2. 然后对该纹理施加各种图像处理效果（如模糊、色调映射、泛光等）
 *   3. 最终将处理后的结果输出到屏幕（或传递给下一个后处理阶段）
 *
 * 本类实现了最基础的后处理单元：将一个纹理作为输入，通过全屏四边形（Full-screen Quad）渲染到目标纹理上。
 * 全屏四边形是后处理的核心概念——它利用两个三角形覆盖整个 NDC（归一化设备坐标）空间（-1 到 1），
 * 然后在片段着色器中对输入纹理进行采样，实现逐像素的图像处理。
 *
 * 【渲染管线流程】
 *   场景渲染 → sourceTexture → [PostProcessEffect] → destinationTexture → 屏幕
 */

import { BufferUtil } from "../utils/buffer-util";
import { Texture } from "../core/texture";
import shaderSource from "../shaders/post-process.wgsl?raw"

export class PostProcessEffect 
{
    /**
     * 输入纹理——存放待处理的图像数据。
     * 外部将场景渲染到此纹理上，然后本类将其作为着色器的输入进行后处理。
     */
    public texture!: Texture;

    /**
     * GPU 渲染管线——定义了顶点着色器、片段着色器以及绑定组布局等。
     * 管线是 WebGPU 中的核心对象，描述了一次绘制调用所需的所有 GPU 状态。
     */
    private gpuPipeline!: GPURenderPipeline;

    /**
     * 顶点缓冲区——存放全屏四边形的顶点数据。
     * 包含 6 个顶点（2 个三角形），每个顶点有 4 个分量：位置(x,y) + 纹理坐标(u,v)。
     */
    private gpuBuffer!: GPUBuffer;

    /**
     * 纹理绑定组——将采样器和纹理视图绑定到着色器中的 @group(0) 资源。
     * 片段着色器通过该绑定组对输入纹理进行采样。
     */
    private textureBindGroup!: GPUBindGroup;

    /**
     * 构造函数
     * @param device - GPU 设备，用于创建所有 GPU 资源
     * @param width  - 渲染目标的宽度（像素）
     * @param height - 渲染目标的高度（像素）
     */
    constructor(private device: GPUDevice,
        public width: number,
        public height: number)
        {

        }    

    /**
     * 初始化后处理效果的所有 GPU 资源。
     * 包括：创建输入纹理、全屏四边形顶点缓冲区、绑定组和渲染管线。
     */
    public async initialize() 
    {
        // 创建空的输入纹理，格式为 bgra8unorm（8位无符号归一化，蓝绿红alpha通道顺序）
        // 该纹理将作为场景渲染的目标，也是后处理着色器的输入源
        this.texture = await Texture.createEmptyTexture(this.device, this.width, this.height, "bgra8unorm");
        
        // =====================================================================
        // 【全屏四边形（Full-screen Quad）】
        // 后处理的关键技术：用两个三角形覆盖整个屏幕空间。
        // 顶点坐标使用 NDC（归一化设备坐标），范围从 -1 到 1：
        //   (-1, 1) -------- (1, 1)     对应屏幕的 左上 到 右上
        //     |                |
        //     |    整个屏幕    |
        //     |                |
        //   (-1,-1) -------- (1,-1)     对应屏幕的 左下 到 右下
        //
        // 纹理坐标 (u, v) 范围从 0 到 1，将整个纹理映射到四边形上：
        //   左上角 (0,0) → 右上角 (1,0) → 左下角 (0,1) → 右下角 (1,1)
        //
        // 注意：在 WebGPU 中，纹理坐标 v=0 对应纹理顶部，v=1 对应底部，
        // 而 NDC 的 y=1 对应屏幕顶部，y=-1 对应底部。
        // 所以左上角 (-1,1) 的纹理坐标是 (0,0)，右下角 (1,-1) 的纹理坐标是 (1,1)。
        // =====================================================================
        this.gpuBuffer = BufferUtil.createVertexBuffer(this.device, new Float32Array([
            // pos(x,y) tex(u,v)

            // first triangle
            // top left 
            -1.0, 1.0, 0.0, 0.0,
            // top right
            1.0, 1.0, 1.0, 0.0,
            // bottom left 
            -1.0, -1.0, 0.0, 1.0,

            // second triangle
            // bottom left
            -1.0, -1.0, 0.0, 1.0,
            // top right
            1.0, 1.0, 1.0, 0.0,
            // bottom right
            1.0, -1.0, 1.0, 1.0
        ]));

        // =====================================================================
        // 【绑定组布局（Bind Group Layout）】
        // 定义着色器可以访问的资源类型和绑定位置：
        //   binding 0: 采样器（Sampler）—— 控制纹理的采样方式（如线性/最近邻过滤）
        //   binding 1: 纹理（Texture）—— 提供像素数据给片段着色器
        // 两者都设置了 FRAGMENT 可见性，意味着只有片段着色器可以访问这些资源。
        // =====================================================================
        const textureBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                }
            ]
        });

        // =====================================================================
        // 【绑定组（Bind Group）】
        // 将实际的 GPU 资源（采样器和纹理视图）绑定到着色器的 @group(0) 中：
        //   binding 0 ← texture.sampler（采样器对象）
        //   binding 1 ← texture.texture.createView()（纹理视图，用于着色器采样）
        // =====================================================================
        this.textureBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.texture.sampler
                },
                {
                    binding: 1,
                    resource: this.texture.texture.createView()
                }
            ]
        });

        // 创建着色器模块，加载 WGSL 后处理着色器代码
        const shaderModule = this.device.createShaderModule({
            code: shaderSource
        });

        // =====================================================================
        // 【渲染管线描述符（Render Pipeline Descriptor）】
        // 渲染管线是 WebGPU 中最重要的对象之一，它定义了：
        //
        // 1. layout: 管线布局——指定着色器使用哪些绑定组布局
        //    这里只有一个绑定组（纹理采样器+纹理），对应着色器中的 @group(0)
        //
        // 2. vertex: 顶点阶段配置
        //    - module/entryPoint: 使用哪个着色器模块和入口函数
        //    - buffers: 顶点缓冲区的布局
        //      * arrayStride: 每个顶点的字节步长 = 4个float × 4字节 = 16字节
        //      * attribute[0]: 位置 (x,y)，shaderLocation=0，偏移量=0，格式=float32x2
        //      * attribute[1]: 纹理坐标 (u,v)，shaderLocation=1，偏移量=8字节，格式=float32x2
        //
        // 3. fragment: 片段阶段配置
        //    - 输出目标格式为 bgra8unorm（与纹理格式一致）
        //
        // 4. primitive: 图元拓扑
        //    - triangle-list: 每三个顶点构成一个三角形
        // =====================================================================
        const desc: GPURenderPipelineDescriptor = {
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [textureBindGroupLayout]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vertexMain",
                buffers: [
                    {
                        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
                        attributes: [
                            {
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x2"
                            },
                            {
                                shaderLocation: 1,
                                offset: 2 * Float32Array.BYTES_PER_ELEMENT,
                                format: "float32x2"
                            }
                        ]
                    }
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fragmentMain",
                targets: [
                    {
                        format: "bgra8unorm"
                    }
                ]
            },
            primitive: {
                topology: "triangle-list"
            }
        };

        // 根据描述符创建 GPU 渲染管线
        this.gpuPipeline = this.device.createRenderPipeline(desc);
    }

    /**
     * 执行后处理绘制操作。
     * 将输入纹理通过全屏四边形渲染到目标纹理视图上。
     *
     * 【渲染流程】
     * 1. 创建命令编码器（Command Encoder）——用于录制 GPU 命令
     * 2. 开启渲染通道（Render Pass）——设置颜色附件为目标纹理视图
     *    - loadOp: "clear" 表示渲染前清空目标（设为黑色）
     *    - storeOp: "store" 表示渲染结果保存到目标纹理
     * 3. 设置管线、顶点缓冲区、绑定组
     * 4. 绘制 6 个顶点（2 个三角形 = 1 个全屏四边形）
     * 5. 提交命令到 GPU 队列执行
     *
     * @param destinationTextureView - 输出目标纹理视图（可以是屏幕或另一个离屏纹理）
     */
    public draw(destinationTextureView: GPUTextureView) 
    {
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: destinationTextureView,
                    loadOp: "clear",
                    storeOp: "store",
                }
            ]
        });

        // 设置渲染管线（包含顶点和片段着色器阶段）
        passEncoder.setPipeline(this.gpuPipeline);
        // 绑定顶点缓冲区到 slot 0
        passEncoder.setVertexBuffer(0, this.gpuBuffer);
        // 绑定纹理资源组到 @group(0)
        passEncoder.setBindGroup(0, this.textureBindGroup);
        // 绘制 6 个顶点，1 个实例，从第 0 个顶点开始
        passEncoder.draw(6, 1, 0, 0);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
