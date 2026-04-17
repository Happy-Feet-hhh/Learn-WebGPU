/**
 * TextureEffect - 纹理混合效果类
 *
 * 【纹理混合（Texture Blending）概述】
 * 该类实现了两张纹理之间的线性混合（Mix/Blend），是后处理管线中的关键组成部分。
 * 典型应用场景：
 *   - 将原始场景纹理与经过模糊处理的纹理混合，实现泛光（Bloom）等效果
 *   - 将屏幕纹理与叠加纹理混合，实现各种屏幕空间特效
 *
 * 【混合公式】
 *   result = screenTexture * (1 - mixValue) + combineTexture * mixValue
 * 其中 mixValue 范围为 [0.0, 1.0]：
 *   - 0.0 = 完全显示 screenTexture
 *   - 0.5 = 两张纹理各占一半
 *   - 1.0 = 完全显示 combineTexture
 *
 * 【绑定组布局】
 * 本类使用了 3 个绑定组：
 *   @group(0): 屏幕纹理（screenTexture）—— 采样器 + 纹理
 *   @group(1): 混合纹理（combineTexture）—— 采样器 + 纹理
 *   @group(2): 混合系数（mixValue）—— uniform 缓冲区
 */

import { BufferUtil } from "../utils/buffer-util";
import { Texture } from "../core/texture";
import shaderSource from "../shaders/texture-effect.wgsl?raw"

export class TextureEffect 
{
    private gpuPipeline!: GPURenderPipeline;
    private gpuBuffer!: GPUBuffer; // vertex buffer

    // =====================================================================
    // 屏幕纹理：通常是原始的场景渲染结果
    // 作为混合操作的"基础层"（base layer）
    // =====================================================================
    public screenTexture!: Texture;
    private screenTextureBindGroup!: GPUBindGroup;

    // =====================================================================
    // 混合纹理：通常是对原始纹理经过某种处理后的结果（如模糊纹理）
    // 通过 setCombineTexture() 方法在外部设置
    // =====================================================================
    private combineTexture!: Texture;
    private combineTextureBindGroupLayout!: GPUBindGroupLayout;
    private combineTextureBindGroup!: GPUBindGroup;

    // =====================================================================
    // 【混合系数（Mix Value）】
    // 控制两张纹理的混合比例，通过 uniform 缓冲区传递给片段着色器。
    // 该值可以动态修改（通过 writeBuffer 实时更新），从而在运行时调节效果强度。
    // =====================================================================
    public mixValue = 0.5;
    private mixValueBuffer!: GPUBuffer;
    private mixValueBindGroup!: GPUBindGroup;



    /**
     * 构造函数
     * @param device - GPU 设备
     * @param width  - 渲染目标宽度
     * @param height - 渲染目标高度
     */
    constructor(private device: GPUDevice,
        public width: number,
        public height: number)
        {

        }    

    /**
     * 设置混合纹理。
     * 该方法允许在外部动态更换混合纹理，例如：
     *   - 将模糊效果输出的纹理设为混合纹理
     *   - 将另一个后处理阶段的输出设为混合纹理
     *
     * 注意：调用此方法前必须先调用 initialize()，因为依赖 combineTextureBindGroupLayout。
     *
     * @param texture - 要混合的第二张纹理
     */
    public setCombineTexture(texture: Texture)
    {
        this.combineTexture = texture;

        this.combineTextureBindGroup = this.device.createBindGroup({
            layout: this.combineTextureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.combineTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.combineTexture.texture.createView()
                }
            ]
        });
    }

    /**
     * 初始化所有 GPU 资源。
     * 创建屏幕纹理、全屏四边形、混合系数 uniform 缓冲区、
     * 三个绑定组及其布局，以及渲染管线。
     */
    public async initialize() 
    {
        // 创建屏幕纹理——用于存放原始场景渲染结果
        this.screenTexture = await Texture.createEmptyTexture(this.device, this.width, this.height, "bgra8unorm");
        
        // 创建全屏四边形顶点缓冲区（与 PostProcessEffect 相同）
        // 6 个顶点构成 2 个三角形，覆盖整个 NDC 空间
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

        // 创建混合系数的 uniform 缓冲区，初始值为 0.5（各占一半）
        // uniform 缓冲区是一种特殊的 GPU 缓冲区，用于向着色器传递小量、频繁更新的数据
        this.mixValueBuffer = BufferUtil.createUniformBuffer(this.device, new Float32Array([this.mixValue]));

        // =====================================================================
        // 绑定组布局 1: 屏幕纹理布局
        // binding 0: 采样器 | binding 1: 纹理
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
        // 绑定组布局 2: 混合纹理布局（与屏幕纹理布局结构相同）
        // 这个布局需要保存为成员变量，因为 setCombineTexture() 需要使用它
        // =====================================================================
        this.combineTextureBindGroupLayout = this.device.createBindGroupLayout({
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
        // 绑定组布局 3: 混合系数 uniform 缓冲区布局
        // binding 0: 一个 uniform 缓冲区，存放 mixValue (float)
        // =====================================================================
        const mixValueBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {}
                }
            ]
        });


        // =====================================================================
        // 创建绑定组实例：将实际 GPU 资源绑定到布局中的槽位
        // =====================================================================

        // 屏幕纹理绑定组——对应着色器中的 @group(0)
        this.screenTextureBindGroup = this.device.createBindGroup({
            layout: textureBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.screenTexture.sampler
                },
                {
                    binding: 1,
                    resource: this.screenTexture.texture.createView()
                }
            ]
        });

        // 混合系数绑定组——对应着色器中的 @group(2)
        // 注意：uniform 缓冲区需要指定偏移量和大小
        this.mixValueBindGroup = this.device.createBindGroup({
            layout: mixValueBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.mixValueBuffer,
                        offset: 0,
                        size: Float32Array.BYTES_PER_ELEMENT
                    }
                }
            ]
        });

        // 创建着色器模块
        const shaderModule = this.device.createShaderModule({
            code: shaderSource
        });

        // =====================================================================
        // 【渲染管线——三个绑定组】
        // 管线布局按顺序包含三个绑定组布局：
        //   @group(0) = textureBindGroupLayout        → 屏幕纹理（sampler + texture）
        //   @group(1) = combineTextureBindGroupLayout  → 混合纹理（sampler + texture）
        //   @group(2) = mixValueBindGroupLayout        → 混合系数（uniform buffer）
        //
        // 这三个绑定组共同作用，让片段着色器能够：
        //   1. 采样屏幕纹理获取基础颜色
        //   2. 采样混合纹理获取叠加颜色
        //   3. 读取 mixValue 来计算两者的加权混合结果
        // =====================================================================
        const desc: GPURenderPipelineDescriptor = {
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [
                    textureBindGroupLayout, // group(0)
                    this.combineTextureBindGroupLayout, // group(1)
                    mixValueBindGroupLayout // group(2)
                ]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vertexMain",
                buffers: [
                    {
                        // 每个顶点 16 字节：position(2×float) + texCoord(2×float)
                        arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
                        attributes: [
                            {
                                // 顶点位置属性：shaderLocation 0, 格式 float32x2, 偏移量 0
                                shaderLocation: 0,
                                offset: 0,
                                format: "float32x2"
                            },
                            {
                                // 纹理坐标属性：shaderLocation 1, 格式 float32x2, 偏移量 8 字节
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

        this.gpuPipeline = this.device.createRenderPipeline(desc);
    }

    /**
     * 执行纹理混合绘制。
     *
     * 【绘制流程】
     * 1. 更新混合系数 uniform 缓冲区（将 CPU 端的 mixValue 写入 GPU 缓冲区）
     * 2. 开启渲染通道，目标为 destinationTextureView
     * 3. 绑定三个资源组：
     *    - @group(0): 屏幕纹理
     *    - @group(1): 混合纹理
     *    - @group(2): 混合系数
     * 4. 绘制全屏四边形（6个顶点）
     *
     * 【关于 writeBuffer 的时序】
     * writeBuffer 在 beginRenderPass 之前调用是安全的，因为命令编码器只是录制命令，
     * 实际执行在 submit() 时才发生。此时 writeBuffer 已经将数据写入 GPU 缓冲区。
     *
     * @param destinationTextureView - 输出目标纹理视图
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

        // 将 CPU 端的 mixValue 实时写入 GPU uniform 缓冲区
        // 这样每帧都可以动态调整混合比例
        this.device.queue.writeBuffer(this.mixValueBuffer, 0, new Float32Array([this.mixValue]));

        passEncoder.setPipeline(this.gpuPipeline);
        passEncoder.setVertexBuffer(0, this.gpuBuffer);
        // 按顺序绑定三个资源组，对应管线布局中的三个 @group
        passEncoder.setBindGroup(0, this.screenTextureBindGroup);
        passEncoder.setBindGroup(1, this.combineTextureBindGroup);
        passEncoder.setBindGroup(2, this.mixValueBindGroup);
        passEncoder.draw(6, 1, 0, 0);

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
