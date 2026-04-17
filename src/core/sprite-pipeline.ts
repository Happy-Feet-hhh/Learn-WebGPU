/**
 * SpritePipeline（精灵渲染管线）
 *
 * 本模块封装了 WebGPU 的渲染管线（GPURenderPipeline）创建逻辑。
 * 渲染管线是 WebGPU 中最核心的对象之一，它定义了：
 *   - 顶点着色器和片段着色器（WGSL 编写）
 *   - 顶点缓冲区的布局格式
 *   - 片段输出的混合状态（Blend State）
 *   - 绑定组布局（Bind Group Layout）和管线布局（Pipeline Layout）
 *
 * 每个管线实例与一个特定的纹理绑定，因为纹理 + 采样器通过 BindGroup 绑定到管线中。
 * 通过使用显式的 Pipeline Layout 和 Bind Group Layout，
 * 可以在多个管线之间共享 uniform 缓冲区（如投影矩阵），而无需重复创建。
 *
 * 绑定组布局：
 *   group(0) —— 投影-视图矩阵（uniform buffer），在顶点着色器中使用
 *   group(1) —— 纹理采样器 + 纹理视图，在片段着色器中使用
 */

import { Texture } from "./texture";
import shaderSource from "../shaders/shader.wgsl?raw";


export class SpritePipeline
{
    /**
     * WebGPU 渲染管线对象。
     * 包含完整的渲染状态配置：着色器、顶点布局、混合状态、图元拓扑等。
     * 一旦创建就不可修改（不可变对象），这是 WebGPU 的设计理念。
     */
    public pipeline!: GPURenderPipeline;

    /**
     * 纹理绑定组（Bind Group）。
     * 对应 @group(1)，包含：
     *   - binding 0: 纹理采样器（sampler）—— 控制纹理过滤和寻址模式
     *   - binding 1: 纹理视图（texture view）—— 指向实际的纹理资源
     * 在片段着色器中通过 @binding(0)/@binding(1) 访问。
     */
    public textureBindGroup!: GPUBindGroup;

    /**
     * 投影-视图矩阵绑定组（Bind Group）。
     * 对应 @group(0)，包含：
     *   - binding 0: uniform buffer —— 存储 4×4 投影-视图矩阵
     * 在顶点着色器中通过 @binding(0) 访问，用于将顶点从世界空间变换到裁剪空间。
     */
    public projectionViewBindGroup!:GPUBindGroup;

    /**
     * 工厂方法：创建 SpritePipeline 实例。
     *
     * @param device                     WebGPU 设备
     * @param texture                    要绑定的纹理
     * @param projectionViewMatrixBuffer 投影-视图矩阵的 uniform 缓冲区
     * @returns 初始化完成的 SpritePipeline 实例
     */
    public static create(device: GPUDevice, texture: Texture, projectionViewMatrixBuffer: GPUBuffer): SpritePipeline
    {
        const pipeline = new SpritePipeline();
        pipeline.initialize(device, texture, projectionViewMatrixBuffer);
        return pipeline;
    }

    /**
     * 初始化渲染管线及其所有相关资源。
     *
     * @param device                     WebGPU 设备
     * @param texture                    要绑定的纹理
     * @param projectionViewMatrixBuffer 投影-视图矩阵的 uniform 缓冲区
     *
     * 初始化步骤：
     *   1. 创建着色器模块（Shader Module）
     *   2. 定义顶点缓冲区布局（Vertex Buffer Layout）
     *   3. 配置顶点状态（Vertex State）
     *   4. 配置片段状态（Fragment State）—— 包含混合模式和多个渲染目标（MRT）
     *   5. 创建绑定组布局（Bind Group Layout）
     *   6. 创建管线布局（Pipeline Layout）
     *   7. 创建绑定组（Bind Group）实例
     *   8. 创建渲染管线（Render Pipeline）
     */
    public initialize(device: GPUDevice, texture: Texture, projectionViewMatrixBuffer: GPUBuffer): void
    {
        // ===== 1. 创建着色器模块 =====
        // 从 WGSL 文件加载着色器源码并编译为 GPU 可执行的着色器模块
        const shaderModule = device.createShaderModule({
            code: shaderSource
          });
      
          // ===== 2. 定义顶点缓冲区布局 =====
          // 描述顶点数据在内存中的排列方式，GPU 据此解析顶点缓冲区数据。
          //
          // arrayStride = 7 × 4 = 28 字节，即每个顶点占 28 字节。
          // 这与 SpriteRenderer 中的 FLOAT_PER_VERTEX (7) 对应。
          //
          // 三个属性（Attributes）：
          //   shaderLocation 0: float32x2 —— 位置 (x, y)，偏移 0 字节
          //   shaderLocation 1: float32x2 —— UV 坐标 (u, v)，偏移 8 字节
          //   shaderLocation 2: float32x3 —— 颜色 (r, g, b)，偏移 16 字节
          //
          // shaderLocation 对应 WGSL 着色器中 @location(N) 的输入/输出标记。
          // stepMode = "vertex" 表示每个顶点读取一组新的属性值。
          const positionBufferLayout: GPUVertexBufferLayout =
          {
            arrayStride: 7 * Float32Array.BYTES_PER_ELEMENT, // 2 floats * 4 bytes per float
            attributes: [
              {
                shaderLocation: 0,   // 对应 WGSL: @location(0) position: vec2f
                offset: 0,
                format: "float32x2" // 2 floats —— 位置 x, y
              },
              {
                shaderLocation: 1,   // 对应 WGSL: @location(1) uv: vec2f
                offset: 2 * Float32Array.BYTES_PER_ELEMENT,  // 跳过前 2 个 float（8 字节）
                format: "float32x2" // 2 floats —— 纹理坐标 u, v
              },
              {
                shaderLocation: 2,   // 对应 WGSL: @location(2) color: vec3f
                offset: 4 * Float32Array.BYTES_PER_ELEMENT,  // 跳过前 4 个 float（16 字节）
                format: "float32x3" // 3 floats —— 颜色 r, g, b
              }
      
            ],
            stepMode: "vertex"
          };
      
      
      
      
          // ===== 3. 配置顶点状态 =====
          // 指定顶点着色器的入口函数和使用的顶点缓冲区布局。
          // entryPoint 必须与 WGSL 着色器中 @vertex fn vertexMain() 的函数名完全一致。
          const vertexState: GPUVertexState = {
            module: shaderModule,
            entryPoint: "vertexMain", // name of the entry point function for vertex shader, must be same as in shader
            buffers: [
              positionBufferLayout,  // 顶点缓冲区布局（slot 0）
            ]
          };
      
          // ===== 4. 配置片段状态 =====
          // 指定片段着色器的入口函数和渲染目标配置。
          //
          // targets 数组定义了多个渲染目标（Multiple Render Targets, MRT）：
          //   targets[0] —— 场景颜色输出：最终的精灵渲染结果
          //   targets[1] —— 亮度提取输出：用于后期处理（如泛光/Bloom 效果）
          //
          // 混合状态（Blend State）：
          //   颜色通道：srcFactor=src-alpha, dstFactor=one-minus-src-alpha
          //     → result = src.rgb * src.a + dst.rgb * (1 - src.a)
          //     → 这是标准的 Alpha 混合公式，用于实现精灵的透明效果
          //   Alpha 通道：srcFactor=one, dstFactor=one-minus-src-alpha
          //     → result.a = src.a * 1 + dst.a * (1 - src.a)
          //
          // 两个渲染目标使用相同的混合配置。
          const fragmentState: GPUFragmentState = {
            module: shaderModule,
            entryPoint: "fragmentMain", // name of the entry point function for fragment/pixel shader, must be same as in shader
            targets: [
              {
                // 渲染目标 0：场景颜色
                format: navigator.gpu.getPreferredCanvasFormat(),
                blend: {
                  color: {
                    srcFactor: "src-alpha",         // 源颜色 × 源 Alpha
                    dstFactor: "one-minus-src-alpha", // 目标颜色 × (1 - 源 Alpha)
                    operation: "add"
                  },
                  alpha: {
                    srcFactor: "one",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add"
                  }
                }
              },
              {
                // 渲染目标 1：亮度提取（MRT 第二输出）
                // 与目标 0 使用相同的格式和混合模式
                format: navigator.gpu.getPreferredCanvasFormat(),
                blend: {
                  color: {
                    srcFactor: "src-alpha",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add"
                  },
                  alpha: {
                    srcFactor: "one",
                    dstFactor: "one-minus-src-alpha",
                    operation: "add"
                  }
                }
              }
            ]
          };
      
          // ===== 5. 创建绑定组布局 =====
          //
          // Bind Group Layout 定义了着色器中 @group(N) 的资源接口。
          // 使用显式布局（而非 "auto"）的优势：
          //   - 可以在多个管线之间共享绑定组
          //   - 投影矩阵缓冲区只需创建一次，所有管线共享同一个 BindGroup
          //
          // group(0) 布局：投影-视图矩阵 uniform 缓冲区
          //   - binding 0: uniform buffer，仅在顶点着色器阶段可见
          const projectionViewBindGroupLayout = device.createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,  // 只有顶点着色器需要读取此矩阵
                buffer: {
                  type: "uniform"                   // uniform 缓冲区类型
                }
              }
            ]
          });
      
          // group(1) 布局：纹理采样器 + 纹理资源
          //   - binding 0: sampler（纹理采样器）—— 控制过滤模式和寻址模式
          //   - binding 1: texture（纹理资源）—— 实际的纹理图像数据
          //   两者仅在片段着色器阶段可见（用于纹理采样）
          const textureBindGroupLayout = device.createBindGroupLayout({
            entries: [
              {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,  // 只有片段着色器需要采样纹理
                sampler: {}                            // 纹理采样器
              },
              {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,  // 只有片段着色器需要读取纹理
                texture: {}                            // 纹理资源
              }
            ]
          });
      
          // ===== 6. 创建管线布局 =====
          // 管线布局将多个绑定组布局组合在一起，定义管线的资源绑定接口。
          // 数组顺序对应 @group(0), @group(1), ...
          const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [
              projectionViewBindGroupLayout,  // @group(0) —— 投影-视图矩阵
              textureBindGroupLayout          // @group(1) —— 纹理 + 采样器
            ]
          });
      
          // ===== 7. 创建绑定组实例 =====
          // 绑定组（Bind Group）是绑定组布局的具体实例化，
          // 将实际的 GPU 资源（缓冲区、纹理、采样器）绑定到着色器槽位。

          // 纹理绑定组：将采样器和纹理视图绑定到 @group(1)
          this.textureBindGroup = device.createBindGroup({
            label: texture.id,
            layout: textureBindGroupLayout,
            entries: [
              {
                binding: 0,
                resource: texture.sampler           // 采样器（控制纹理过滤/寻址）
              },
              {
                binding: 1,
                resource: texture.texture.createView()  // 纹理视图（指定纹理的哪一部分可访问）
              }
            ]
          });
      
          // 投影-视图矩阵绑定组：将 uniform 缓冲区绑定到 @group(0)
          // 注意：此缓冲区是共享的，所有管线实例使用同一个缓冲区（通过显式布局实现）
          this.projectionViewBindGroup = device.createBindGroup({
            layout: projectionViewBindGroupLayout,
            entries: [
              {
                binding: 0,
                resource: {
                  buffer: projectionViewMatrixBuffer,  // 共享的投影-视图矩阵缓冲区
                }
              }
            ]
          });
      
      
      
          // ===== 8. 创建渲染管线 =====
          // 将所有配置组装成最终的 GPURenderPipeline 对象。
          // 管线是 WebGPU 中最重的对象之一，创建成本较高，因此应该缓存复用。
          this.pipeline = device.createRenderPipeline({
            vertex: vertexState,       // 顶点着色器配置
            fragment: fragmentState,   // 片段着色器配置（含渲染目标和混合状态）
            primitive: {
              topology: "triangle-list" // type of primitive to render
              // 图元拓扑类型：triangle-list 表示每 3 个顶点构成一个独立的三角形
              // 配合索引缓冲区使用，2 个三角形拼成 1 个精灵四边形
            },
            layout: pipelineLayout,    // 使用显式管线布局（而非 "auto"）
          });
      
    }
}
