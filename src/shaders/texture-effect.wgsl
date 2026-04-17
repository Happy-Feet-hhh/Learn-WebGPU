// =============================================================================
// WGSL 纹理混合着色器 (Texture Mix Effect Shader)
// =============================================================================
//
// 【本文件功能】
// 在两张纹理之间进行线性插值混合，由一个 uniform 变量控制混合比例。
// 可以实现场景与另一张纹理之间的平滑过渡效果（如幻灯片切换、
// 特效叠加、纹理淡入淡出等）。
//
// 【核心算法】
// 使用 WGSL 内建函数 mix() 进行线性插值：
//   mix(a, b, t) = a × (1 - t) + b × t
//   当 t = 0.0 时，结果为 a（完全使用第一张纹理）
//   当 t = 1.0 时，结果为 b（完全使用第二张纹理）
//   当 t = 0.5 时，结果为 a 和 b 的等量混合
// =============================================================================

// ---------------------------------------------------------------------------
// 顶点着色器输出结构体
// ---------------------------------------------------------------------------
struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) texCoords: vec2f
}

// ---------------------------------------------------------------------------
// 顶点着色器入口函数
// ---------------------------------------------------------------------------
// 后处理管线的标准顶点着色器：传递全屏四边形的 NDC 坐标
@vertex 
fn vertexMain(
    @location(0) pos: vec2f,
    @location(1) texCoords: vec2f,
) -> VertexOut 
{ 
    var output : VertexOut; 

    output.position = vec4f(pos, 0.0, 1.0);
    output.texCoords = texCoords;

    return output;
}

// ---------------------------------------------------------------------------
// 片段着色器资源绑定
// ---------------------------------------------------------------------------
// 绑定组 0：第一张纹理（场景纹理）
// 作为混合的基础颜色来源
@group(0) @binding(0)
var texSampler0: sampler;

@group(0) @binding(1)
var tex0: texture_2d<f32>;

// 绑定组 1：第二张纹理（叠加纹理）
// 作为混合的目标颜色来源
@group(1) @binding(0)
var texSampler1: sampler;

@group(1) @binding(1)
var tex1: texture_2d<f32>;

// 绑定组 2：混合系数（uniform 变量）
// @group(2) @binding(0) — 位于绑定组 2 的第 0 个槽位
// var<uniform> — uniform 存储地址空间，每帧由 TypeScript 端更新
// mixValue 的范围通常为 [0.0, 1.0]：
//   0.0 = 完全显示 tex0（场景纹理）
//   1.0 = 完全显示 tex1（叠加纹理）
//   0.5 = 两张纹理各占 50%
@group(2) @binding(0)
var<uniform> mixValue: f32;

// ---------------------------------------------------------------------------
// 片段着色器入口函数 — 纹理混合
// ---------------------------------------------------------------------------
@fragment
fn fragmentMain(fragData: VertexOut ) -> @location(0) vec4f 
{
    // 采样第一张纹理（场景纹理）
    var screenTexture = textureSample(tex0, texSampler0, fragData.texCoords);

    // 采样第二张纹理（叠加纹理）
    var combineTexture = textureSample(tex1, texSampler1, fragData.texCoords);

    // =======================================================================
    // 纹理混合：使用 WGSL 内建函数 mix()
    // =======================================================================
    // mix(a, b, t) 的数学定义：
    //   result = a * (1.0 - t) + b * t
    //
    // 这里：
    //   a = screenTexture.xyz（场景纹理颜色）
    //   b = combineTexture.xyz（叠加纹理颜色）
    //   t = mixValue（由 TypeScript 端通过 uniform 传入的混合系数）
    //
    // 通过动态调整 mixValue，可以实现平滑的纹理过渡动画
    // =======================================================================
    var mixColor = mix(screenTexture.xyz, combineTexture.xyz, mixValue);

    // 输出混合后的颜色，alpha 固定为 1.0（完全不透明）
    return vec4f(mixColor, 1.0);
}
