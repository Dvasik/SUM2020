'use strict';

class FractalDrawer {
  vxShaderStr = `#version 300 es
  in vec3 aVertexPosition;
  in vec2 aTextureCoord;
  
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  
  void main(void)
  {
      gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);
  }
  `;

  fsShaderStr = `#version 300 es
  precision mediump float;
  
  uniform float uTime;
  uniform vec4 borders;
  uniform vec2 mPos;
  uniform sampler2D uSampler;
  uniform bool isTexture;
  uniform vec3 nColor;
  out vec4 oColor;
  
  struct cmpl
  {
    float r, i;  
  };
  
  cmpl CmplSet( float r, float i )
  {
    cmpl R;
    R.r = r;
    R.i = i;
  
    return R;
  }
  
  cmpl CmplAddCmpl( cmpl A, cmpl B )
  {
    return cmpl(A.r + B.r, A.i + B.i);
  }
  
  cmpl CmplMulCmpl( cmpl A, cmpl B )
  {
    return cmpl(A.r * B.r - A.i * B.i, A.r * B.i + A.i * B.r);
  }
  
  float CmplLen2( cmpl A )
  {
    return A.r * A.r + A.i * A.i;
  }
  
  float Mandl( cmpl Z, cmpl C )
  {
    float n = 0.0;
    cmpl Z0 = Z;
  
    while (n < 255.0 && CmplLen2(Z) < 4.0)
    {
      Z = CmplAddCmpl(CmplMulCmpl(Z, Z), C);
      n++;
    }
    return n;
  }
  
  void main(void)
  {
    float n;
    cmpl C, Z;
    C.r = -.4 * cos(uTime);
    C.i = -.6 * -sin(uTime);
    vec2 xy = borders.xz + gl_FragCoord.xy / 500.0 * (borders.yw - borders.xz);
  
    Z = cmpl(xy.x, xy.y);
    n = Mandl(Z, C);
    if (isTexture)
      oColor = texture(uSampler, vec2(n / 255.0, 1.0 - n / 255.0));
    else
      oColor = vec4(nColor.x * n / 255.0, nColor.y * n / 255.0, nColor.z * n / 255.0, 1.0);
  }`;

  shaderProgram = 0;
  mvMatrix = mat4.create();
  pMatrix = mat4.create();
  checkersCellWidth = 30;
  uTimeMs = 0;
  globalMs = Date.now() / 1000.0;
  isPause = false;
  zoom = 0.5;
  mousePos = [0.0, 0.0];
  transPos = [0.0, 0.0];
  isHold = false;
  isTexture = true;
  color = '#FF0000';
  borders =
  {
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    scale: 1
  };
  
  initGL = (canvas) => {
    try {
      this.gl = canvas.getContext('webgl2');
      this.gl.viewportWidth = canvas.width;
      this.gl.viewportHeight = canvas.height;
    } catch (e) {
    }
    if (!this.gl) {
      alert('Could not initialize WebGL');
    }
  }

  getShader = (gl, type, str) => {
    let shader;
    shader = gl.createShader(type);
  
    gl.shaderSource(shader, str);
    gl.compileShader(shader);
  
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      alert(gl.getShaderInfoLog(shader));
      return null;
    }
  
    return shader;
  }

  initShaders = () => {
    const fragmentShader = this.getShader(this.gl, this.gl.FRAGMENT_SHADER, this.fsShaderStr);
    const vertexShader = this.getShader(this.gl, this.gl.VERTEX_SHADER, this.vxShaderStr);
  
    this.shaderProgram = this.gl.createProgram();
    this.gl.attachShader(this.shaderProgram, vertexShader);
    this.gl.attachShader(this.shaderProgram, fragmentShader);
    this.gl.linkProgram(this.shaderProgram);
  
    if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
      alert('Could not initialize shaders');
    }
  
    this.gl.useProgram(this.shaderProgram);
  
    this.shaderProgram.vertexPositionAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aVertexPosition');
    this.gl.enableVertexAttribArray(this.shaderProgram.vertexPositionAttribute);
  
    this.shaderProgram.pMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uPMatrix');
    this.shaderProgram.mvMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uMVMatrix');
    this.shaderProgram.uCellWidth = this.gl.getUniformLocation(this.shaderProgram, 'uCellWidth');
    this.shaderProgram.uTime = this.gl.getUniformLocation(this.shaderProgram, 'uTime');
    this.shaderProgram.zoom_uniform = this.gl.getUniformLocation(this.shaderProgram, 'zoom');
    this.shaderProgram.borders_uniform = this.gl.getUniformLocation(this.shaderProgram, 'borders');
    this.shaderProgram.mPos = this.gl.getUniformLocation(this.shaderProgram, 'mPos');
    this.shaderProgram.uSampler = this.gl.getUniformLocation(this.shaderProgram, 'uSampler');
    this.shaderProgram.isTexture = this.gl.getUniformLocation(this.shaderProgram, 'isTexture');
    this.shaderProgram.color = this.gl.getUniformLocation(this.shaderProgram, 'nColor');
  }

  initBuffers = () => {
    this.squareVertexPositionBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareVertexPositionBuffer);
    const vertices = [
      1.0, 1.0, 0.0,
      -1.0, 1.0, 0.0,
      1.0, -1.0, 0.0,
      -1.0, -1.0, 0.0
    ];
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
    this.squareVertexPositionBuffer.itemSize = 3;
    this.squareVertexPositionBuffer.numItems = 4;
  }

  loadTextures = (fName) => {
    this.texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
  
    const level = 0;
    const internalFormat = this.gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = this.gl.RGBA;
    const srcType = this.gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([0, 0, 255, 255]);
    this.gl.texImage2D(this.gl.TEXTURE_2D, level, internalFormat,
      width, height, border, srcFormat, srcType,
      pixel);
  
    const image = new Image();
    image.onload = () => {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, level, internalFormat,
        srcFormat, srcType, image);
  
      if (((image.width & (image.width - 1)) === 0) && ((image.height & (image.height - 1)) === 0)) {
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
      } else {
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      }
    };
    image.src = fName;
  }

  setUniforms = () => {
    this.gl.uniformMatrix4fv(this.shaderProgram.pMatrixUniform, false, this.pMatrix);
    this.gl.uniformMatrix4fv(this.shaderProgram.mvMatrixUniform, false, this.mvMatrix);
    this.gl.uniform1f(this.shaderProgram.uCellWidth, this.checkersCellWidth);
    this.gl.uniform1f(this.shaderProgram.uTime, this.uTimeMs);
    this.gl.uniform1f(this.shaderProgram.zoom_uniform, this.zoom);
    this.gl.uniform4f(this.shaderProgram.borders_uniform, this.borders.left, this.borders.right, this.borders.bottom, this.borders.top);
    this.gl.uniform2f(this.shaderProgram.mPos, this.transPos[0], this.transPos[1]);
    this.gl.uniform1i(this.shaderProgram.isTexture, this.isTexture);
    this.gl.uniform3f(this.shaderProgram.color, (parseInt(this.color[1], 16) * 16 + parseInt(this.color[2], 16)) / 255.0, (parseInt(this.color[3], 16) * 16 + parseInt(this.color[4], 16)) / 255.0, (parseInt(this.color[5], 16) * 16 + parseInt(this.color[6], 16)) / 255.0);
  }

  drawScene = () => {
    this.uTimeMs += !this.isPause * (Date.now() / 1000.0 - this.globalMs);
    this.globalMs = Date.now() / 1000.0;
    
    this.gl.viewport(0, 0, this.gl.viewportWidth, this.gl.viewportHeight);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  
    mat4.perspective(45, this.gl.viewportWidth / this.gl.viewportHeight, 0.1, 100.0, this.pMatrix);
  
    mat4.identity(this.mvMatrix);
  
    mat4.translate(this.mvMatrix, [0.0, 0.0, -1.0]);
  
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareVertexPositionBuffer);
    this.gl.vertexAttribPointer(this.shaderProgram.vertexPositionAttribute, this.squareVertexPositionBuffer.itemSize, this.gl.FLOAT, false, 0, 0);
    this.gl.enableVertexAttribArray(this.shaderProgram.vertexPositionAttribute);
    this.setUniforms();
  
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.uniform1i(this.shaderProgram.uSampler, 0);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, this.squareVertexPositionBuffer.numItems);
  }

  tick = () => {
    window.requestAnimationFrame(this.tick);
    this.drawScene();
    // console.log('tick' + new Date());
  }

  controls = new function () {
    this.color = '#FF0000';
    this.isTexture = true;
  }();
  
  setValue = () => {
    this.isTexture = this.controls.isTexture;
    this.color = this.controls.color;
  }

  createBorders = (mPos, scroll) => {
    let updateScale = 1;
  
    if (scroll > 0) { updateScale *= 1 + 0.5 * scroll / 100; } else { updateScale /= 1 - 0.5 * scroll / 100; }
  
    this.zoom = updateScale;
  
    const newLeft = this.borders.left + mPos.x / 500.0 * (this.borders.right - this.borders.left) * (1 - updateScale);
    const newBottom = this.borders.bottom + mPos.y / 500.0 * (this.borders.top - this.borders.bottom) * (1 - updateScale);
    const newRight = newLeft + (this.borders.right - this.borders.left) * updateScale;
    const newTop = newBottom + (this.borders.top - this.borders.bottom) * updateScale;
  
    this.borders.left = newLeft;
    this.borders.right = newRight;
    this.borders.bottom = newBottom;
    this.borders.top = newTop;
  }

  constructor () {
    const canvas = document.getElementById('webglCanvas');
    this.gui = new dat.GUI();
    this.gui.addColor(this.controls, 'color').onChange(this.setValue);
    this.gui.add(this.controls, 'isTexture').onChange(this.setValue);    

    function writeMessage (canvas, message) {
      console.log(message);
    }

    function getMousePos (canvas, evt) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
      };
    }
  
    document.addEventListener('keydown', (evt) => {
      if (evt.key == 'p' || evt.key == 'P') { this.isPause = !this.isPause; } else if (evt.key == 'w' || evt.key == 'W') { this.uTimeMs += 0.05; } else if (evt.key == 's' || evt.key == 'S') { this.uTimeMs -= 0.05; }
    }, false);

    canvas.addEventListener('wheel', (evt) => {
      this.mousePos = getMousePos(canvas, evt);
      let mMPos = {x:this.mousePos.x, y:800 - this.mousePos.y}
      this.createBorders(mMPos, evt.deltaY / 10.0);
    }, false);
  
    canvas.addEventListener('mousedown', (evt) => {
      this.mousePos = getMousePos(canvas, evt);
      this.isHold = true;
    }, false);
  
    canvas.addEventListener('mousemove', (evt) => {
      if (this.isHold === true) {
        const prevMousePos = this.mousePos;
        this.mousePos = getMousePos(canvas, evt);
        document.getElementById('webglCanvas').style.cursor = 'move';
  
        const newLeft = this.borders.left + -(this.mousePos.x - prevMousePos.x) / 500.0 * (this.borders.right - this.borders.left);
        const newBottom = this.borders.bottom + (this.mousePos.y - prevMousePos.y) / 500.0 * (this.borders.top - this.borders.bottom);
        const newRight = newLeft + (this.borders.right - this.borders.left);
        const newTop = newBottom + (this.borders.top - this.borders.bottom);
  
        this.borders.left = newLeft;
        this.borders.right = newRight;
        this.borders.bottom = newBottom;
        this.borders.top = newTop;
      }
    }, false);
  
    canvas.addEventListener('mouseup', (evt) => {
      if (this.isHold === true) {
        document.getElementById('webglCanvas').style.cursor = 'default';
        this.isHold = false;
      }
    }, false);
  
    
    this.initGL(canvas);
    this.initShaders();
    this.initBuffers();
    this.loadTextures('BIN/Textures/test3.jpg');
    this.gl.clearColor(0.25, 0.47, 0.8, 1.0);
    this.gl.enable(this.gl.DEPTH_TEST);
    
    this.tick();
  }
}

function main () {
  new FractalDrawer();
}