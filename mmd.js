let shader = {
    uniforms: THREE.UniformsUtils.merge( [
        THREE.UniformsLib.common,
        THREE.UniformsLib.aomap,
        THREE.UniformsLib.lightmap,
        THREE.UniformsLib.emissivemap,
        THREE.UniformsLib.bumpmap,
        THREE.UniformsLib.normalmap,
        THREE.UniformsLib.displacementmap,
        THREE.UniformsLib.gradientmap,
        THREE.UniformsLib.fog,
        THREE.UniformsLib.lights,
        {
            emissive: { value: new THREE.Color( 0x000000 ) },
            specular: { value: new THREE.Color( 0x111111 ) },
            shininess: { value: 30 },
            mirrorSampler: { value: null },
            textureMatrix : { value: new THREE.Matrix4() }
        }
    ] ),

    vertexShader: 
    `
        #define PHONG
        varying vec3 vViewPosition;
        #ifndef FLAT_SHADED
            varying vec3 vNormal;
        #endif

        #include <common>
        #include <uv_pars_vertex>
        #include <uv2_pars_vertex>
        #include <displacementmap_pars_vertex>
        #include <envmap_pars_vertex>
        #include <color_pars_vertex>
        #include <fog_pars_vertex>
        #include <morphtarget_pars_vertex>
        #include <skinning_pars_vertex>
        #include <shadowmap_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        #include <clipping_planes_pars_vertex>

        uniform mat4 textureMatrix;
        varying vec4 mirrorCoord;

        void main() {
            #include <uv_vertex>
            #include <uv2_vertex>
            #include <color_vertex>
            #include <beginnormal_vertex>
            #include <morphnormal_vertex>
            #include <skinbase_vertex>
            #include <skinnormal_vertex>
            #include <defaultnormal_vertex>

            #ifndef FLAT_SHADED // Normal computed with derivatives when FLAT_SHADED
                vNormal = normalize( transformedNormal );
            #endif

            #include <begin_vertex>
            #include <displacementmap_vertex>
            #include <morphtarget_vertex>
            #include <skinning_vertex>
            #include <project_vertex>
            #include <logdepthbuf_vertex>
            #include <clipping_planes_vertex>

            vViewPosition = - mvPosition.xyz;
            
            #include <worldpos_vertex>
            #include <envmap_vertex>
            #include <shadowmap_vertex>
            #include <fog_vertex>

            mirrorCoord = textureMatrix * worldPosition;
        }
    `,

    fragmentShader: 
    `
        #define PHONG
        uniform vec3 diffuse;
        uniform vec3 emissive;
        uniform vec3 specular;
        uniform float shininess;
        uniform float opacity;
        #include <common>
        #include <packing>
        #include <color_pars_fragment>
        #include <uv_pars_fragment>
        #include <uv2_pars_fragment>
        #include <map_pars_fragment>
        #include <alphamap_pars_fragment>
        #include <aomap_pars_fragment>
        #include <lightmap_pars_fragment>
        #include <emissivemap_pars_fragment>
        #include <envmap_pars_fragment>
        #include <gradientmap_pars_fragment>
        #include <fog_pars_fragment>
        #include <bsdfs>
        #include <lights_pars>
        #include <lights_phong_pars_fragment>
        #include <shadowmap_pars_fragment>
        #include <bumpmap_pars_fragment>
        #include <normalmap_pars_fragment>
        #include <specularmap_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        #include <clipping_planes_pars_fragment>

        uniform sampler2D mirrorSampler;
        varying vec4 mirrorCoord;

        float blendOverlay(float base, float blend) {
            return( base < 0.5 ? ( 2.0 * base * blend ) : (1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
        }

        void main() {
            #include <clipping_planes_fragment>
            vec4 diffuseColor = vec4( diffuse, opacity );
            ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
            vec3 totalEmissiveRadiance = emissive;

            #include <logdepthbuf_fragment>
            #include <map_fragment>
            #include <color_fragment>
            #include <alphamap_fragment>
            #include <alphatest_fragment>
            #include <specularmap_fragment>
            #include <normal_flip>
            #include <normal_fragment>
            #include <emissivemap_fragment>

            // accumulation
            #include <lights_phong_fragment>
            #include <lights_template>

            // modulation
            #include <aomap_fragment>
            
            vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
            #include <envmap_fragment>

            vec4 mirrorValue = texture2DProj(mirrorSampler, mirrorCoord);
            vec4 lightColor = vec4( outgoingLight, diffuseColor.a );
            gl_FragColor = vec4(blendOverlay(lightColor.r, mirrorValue.r), blendOverlay(lightColor.g, mirrorValue.g), blendOverlay(lightColor.b, mirrorValue.b), 1.0);

            #include <premultiplied_alpha_fragment>
            #include <tonemapping_fragment>
            #include <encodings_fragment>
            #include <fog_fragment>
        }
    `
};

var container, stats, loaderUI, progressBlue;

var modelMesh, controlCamera, screenCamera, scene, renderer, effect;
var helper, ikHelper, physicsHelper;

var mouseX = 0, mouseY = 0;
var clock = new THREE.Clock();

let audioPlayer, audioVolume;
let circleFloor, screen, rtTexture;
let spotLight1,spotLight2,spotLight3;
let lightHelper1,lightHelper2,lightHelper3;
let textureLoader = new THREE.TextureLoader();
var pointLight;


let mirror, floorMaterial;
let crowd = [];
let textureSize = 1024;
let screenRatio = 1920/1080;
let screenHeight = 60;

window.onload = init;

function init() {
    loaderUI = document.getElementById('loader');
    progressBlue = document.getElementById('progressBlue');
    container = document.createElement( 'div' );

    controlCamera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 1, 2000 );
    controlCamera.position.set(0,50,100);

    screenCamera = new THREE.PerspectiveCamera( 30, screenRatio, 1, 2000 ); 
    screenCamera.position.set(0,10,0);

    // scene
    scene = new THREE.Scene();

    rtTexture = new THREE.WebGLRenderTarget( textureSize, textureSize, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter, format: THREE.RGBFormat } );
    screen = new THREE.Mesh(new THREE.PlaneBufferGeometry(screenRatio*screenHeight,screenHeight), new THREE.MeshPhongMaterial({color: 0xFFFFFF, map:rtTexture.texture}));
    screen.position.set(0,30,-100);
    scene.add(screen);

    createLight();
    // createCrowd();

    // renderer
    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setClearColor( new THREE.Color( 0x000000 ) );
    renderer.shadowMapEnabled = true;
    renderer.shadowMapType = THREE.PCFSoftShadowMap;
    container.appendChild( renderer.domElement );

    effect = new THREE.OutlineEffect( renderer );
    // mirror = new MirrorReflection( controlCamera, { clipBias: 0.003,textureWidth:textureSize, textureHeight:textureSize } );

    floorMaterial = new THREE.ShaderMaterial({
        vertexShader:shader.vertexShader,
        fragmentShader:shader.fragmentShader,
        uniforms:shader.uniforms,
        lights:true
    });
    // floorMaterial.uniforms.mirrorSampler.value = mirror.renderTarget.texture;
    // floorMaterial.uniforms.textureMatrix.value = mirror.textureMatrix;
    floorMaterial.outlineParameters = {
        visible: false
    };
    
    circleFloor = new THREE.Mesh( new THREE.CircleBufferGeometry( 45, 64), floorMaterial );
    circleFloor.add( mirror );
    circleFloor.rotateX( - Math.PI / 2 );
    circleFloor.receiveShadow = true;
    circleFloor.position.setY(-0.1);
    scene.add( circleFloor );

    // STATS
    stats = new Stats();
    container.appendChild( stats.dom );

    // model
    var onProgress1 = function ( xhr ) {
        if ( xhr.lengthComputable ) {
            var percentComplete = Math.round(xhr.loaded / xhr.total * 100)/4;
            progressBlue.style.width = percentComplete +'%';
            progressBlue.innerHTML = percentComplete +'%';
        }
    };
    var onProgress2 = function ( xhr ) {
        if ( xhr.lengthComputable ) {
            var percentComplete = Math.round(xhr.loaded / xhr.total * 100)/4 + 33;
            progressBlue.style.width = percentComplete +'%';
            progressBlue.innerHTML = percentComplete +'%';
        }
    };
    var onProgress3 = function ( xhr ) {
        if ( xhr.lengthComputable ) {
            var percentComplete = Math.round(xhr.loaded / xhr.total * 100)/4 + 66;
            progressBlue.style.width = percentComplete +'%';
            progressBlue.innerHTML = percentComplete +'%';
        }
    };

    var onError = function ( xhr ) {
    };

    var modelFile = 'data/MEIKO.pmd';
    var vmdFiles = [ 'data/motion.vmd' ];
    var audioFile = 'data/Niconico_Video-GINZA.mp3';
    var cameraFiles = [ 'data/camera.vmd' ];
    let stageFile = 'data/wire_stage8blue.pmx';

    helper = new THREE.MMDHelper();
    var loader = new THREE.MMDLoader();

    loader.loadAudio(audioFile, function(audio,listener){
        audioVolume = audio.getVolume();
        helper.setAudio(audio,listener);
        audioPlayer = audio;

        loader.loadVmds( cameraFiles, function ( vmd ) {
            helper.setCamera( screenCamera );
            loader.pourVmdIntoCamera( screenCamera, vmd );
            helper.setCameraAnimation( screenCamera );

            loader.load( modelFile, vmdFiles, function ( object ) {

                modelMesh = object;
                modelMesh.castShadow = true;
                scene.add( modelMesh );

                helper.add( modelMesh );
                helper.setAnimation( modelMesh );

                /*
                * Note: create CCDIKHelper after calling helper.setAnimation()
                */
                ikHelper = new THREE.CCDIKHelper( modelMesh );
                ikHelper.visible = false;
                scene.add( ikHelper );

                /*
                * Note: You're recommended to call helper.setPhysics()
                *       after calling helper.setAnimation().
                */
                helper.setPhysics( modelMesh );
                physicsHelper = new THREE.MMDPhysicsHelper( modelMesh );
                physicsHelper.visible = false;
                scene.add( physicsHelper );
                helper.unifyAnimationDuration();
                initGui();
                animate();
                moveLight();
                // moveOtaku();
                document.body.removeChild( loaderUI );
                document.body.appendChild( container );
            }, onProgress3, onError );
        }, onProgress2, onError );
    }, onProgress1, onError);

    // set control
    var controls = new THREE.OrbitControls( controlCamera, renderer.domElement );

    window.addEventListener( 'resize', onWindowResize, false );

    var phongMaterials;
    var originalMaterials;

    function makeLambertMaterials ( materials ) {

        var array = [];

        for ( var i = 0, il = materials.length; i < il; i ++ ) {

            var m = new THREE.MeshLambertMaterial();
            m.copy( materials[ i ] );
            m.needsUpdate = true;

            array.push( m );
        }
        return new THREE.MultiMaterial( array );
    }

    function makeStageMaterials(materials){
        var array = [];
        for ( var i = 0, il = materials.length; i < il; i ++ ) {
            // deal with strange nude effect
            let result = materials[i].name.match(/_PRESET_hanasi\d/);
            if(result === null){
                array.push( materials[ i ] );
            }
            else {
                var m = new THREE.MeshLambertMaterial();
                m.color = materials[ i ].color;
                m.emissive = materials[ i ].emissive;
                m.emissiveIntensity = materials[ i ].emissiveIntensity;
                m.needsUpdate = true;
                array.push( m );
            }
        }
        return new THREE.MultiMaterial( array );
    }

    function initGui () {

        var api = {
            'gradient mapping': true,
            'ik': true,
            'outline': true,
            'physics': true,
            'show IK bones': false,
            'show rigid bodies': false,
            'audio':true
        };

        var gui = new dat.GUI();

        gui.add( api, 'gradient mapping' ).onChange( function () {

            if ( originalMaterials === undefined ) 
                originalMaterials = modelMesh.material;
            if ( phongMaterials === undefined ) 
                phongMaterials = makeLambertMaterials( modelMesh.material.materials );

            if ( api[ 'gradient mapping' ] ) {
                modelMesh.material = originalMaterials;
            } else {
                modelMesh.material = phongMaterials;
            }

        } );

        gui.add( api, 'ik' ).onChange( function () {
            helper.doIk = api[ 'ik' ];
        } );

        gui.add( api, 'outline' ).onChange( function () {
            effect.enabled = api[ 'outline' ];
        } );

        gui.add( api, 'physics' ).onChange( function () {
            helper.enablePhysics( api[ 'physics' ] );
        } );

        gui.add( api, 'show IK bones' ).onChange( function () {
            ikHelper.visible = api[ 'show IK bones' ];
        } );

        gui.add( api, 'show rigid bodies' ).onChange( function () {
            if ( physicsHelper !== undefined ) physicsHelper.visible = api[ 'show rigid bodies' ];
        } );

        gui.add( api, 'audio' ).onChange( function () {
            if ( audioPlayer !== undefined ) {
                if(api[ 'audio' ])
                    audioPlayer.setVolume(audioVolume);
                else
                    audioPlayer.setVolume(0);
            }
        } );
    }
}

function onWindowResize() {

    controlCamera.aspect = window.innerWidth / window.innerHeight;
    controlCamera.updateProjectionMatrix();

    effect.setSize( window.innerWidth, window.innerHeight );
}

// render
function animate() {
    requestAnimationFrame( animate );
    // TWEEN.update();
    stats.begin();
    render();
    stats.end();
}

function render() {
    
    if ( lightHelper1 ) lightHelper1.update();
    // if ( lightHelper2 ) lightHelper2.update();
    // if ( lightHelper3 ) lightHelper3.update();

    helper.animate( clock.getDelta() );
    if ( physicsHelper !== undefined && physicsHelper.visible ) physicsHelper.update();
    if ( ikHelper !== undefined && ikHelper.visible ) ikHelper.update();

    // render to screen
    // effect.render( scene, screenCamera, rtTexture, true);
    // render mirror
    // mirror.updateTextureMatrix();
    // renderer.render( scene, mirror.mirrorCamera, mirror.renderTarget, true);

    effect.render( scene, controlCamera );
}

// crowd
/**
* Returns a random number between min (inclusive) and max (exclusive)
*/
function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min;
}
/**
* Returns a random integer between min (inclusive) and max (inclusive)
* Using Math.round() will give you a non-uniform distribution!
*/
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createCrowd(){
    let innerRadius = 60;
    let outerRadius = 80;
    let spriteMap = textureLoader.load( 'data/person.png' );
    let spriteMaterial = new THREE.SpriteMaterial( { map: spriteMap, color: 0xffffff } );

    for(i = 0; i < 200; i++){
        let theta = Math.random()*Math.PI*2;
        let radius = getRandomArbitrary(innerRadius, outerRadius);
        createOtaku(radius*Math.cos(theta),0,radius*Math.sin(theta), spriteMaterial);
    }
}

function createOtaku(x,y,z,spriteMaterial){
    let scale = 5;
    let sprite = new THREE.Sprite( spriteMaterial );
    sprite.scale.set(scale, 2*scale, 1);
    sprite.position.set(x,y,z);
    crowd.push(sprite);
    scene.add(sprite);
}
function moveOtaku(){
    let index = getRandomInt(0,crowd.length-1);
    let otaku = crowd[index];

    let jump =  new TWEEN.Tween(otaku.position).to({
            y: 5
        }, 200 )
        .easing( TWEEN.Easing.Quintic.Out );
    let fall = new TWEEN.Tween(otaku.position).to({
            y: 0
        }, 200 )
        .easing( TWEEN.Easing.Quintic.Out );
    
    jump.repeat(1);
    jump.chain(fall);
    jump.start();

    setTimeout(moveOtaku, 2000);
}


// light
var lightdegree = 0;
var lightPoint;
function moveLight(){

    // tween( spotLight1 );
    // tween( spotLight2 );
    // tween( spotLight3 );
    lightdegree++;
    let lightradian = lightdegree%360*Math.PI/180;
    x = 50*Math.cos(lightradian);
    y = 50*Math.sin(lightradian);
    pointLight.position.set( x, y, 0 );
    lightPoint.position.set(x,y,0);
    setTimeout(moveLight, 20);
}
function createLight(){
    var ambient = new THREE.AmbientLight( 0x808080 );
    scene.add( ambient );

    lightPoint = new THREE.Mesh(new THREE.SphereBufferGeometry(5,32,32), new THREE.MeshBasicMaterial({color:0xFF7F00}));
    lightPoint.position.set(0,50,0);
    scene.add(lightPoint);
    pointLight = new THREE.PointLight(0xFF7F00,1,100);
    pointLight.position.set(0,50,0);
    scene.add(pointLight);
    // for(i = 0 ; i < 1 ; i++){
        // spotLight1 = createSpotlight( 0xFF7F00 );
        // spotLight1.position.set( 0, 50, 0 );
        // scene.add(spotLight1);
    // }
    // spotLight1 = createSpotlight( 0xFF7F00 );
    // spotLight2 = createSpotlight( 0x00FF7F );
    // spotLight3 = createSpotlight( 0x7F00FF );
    // spotLight1.position.set( 15, 40, 45 );
    // spotLight2.position.set( 0, 40, 35 );
    // spotLight3.position.set( -15, 40, 45 );
    
    // lightHelper1 = new THREE.SpotLightHelper( spotLight1 );
    // lightHelper2 = new THREE.SpotLightHelper( spotLight2 );
    // lightHelper3 = new THREE.SpotLightHelper( spotLight3 );

    // scene.add( spotLight1, spotLight2, spotLight3 );
    // scene.add( lightHelper1);
}

function createSpotlight( color ) {
    var newObj = new THREE.SpotLight( color, 0.5 );
    newObj.castShadow = true;
    newObj.angle = 0.3;
    newObj.penumbra = 0.2;
    newObj.decay = 2;
    newObj.distance = 100;
    newObj.shadow.mapSize.width = 512;
    newObj.shadow.mapSize.height = 512;
    return newObj;
}
function tween( light ) {

    new TWEEN.Tween( light ).to( {
        angle: ( Math.random() * 0.7 ) + 0.1,
        penumbra: Math.random() + 1
    }, Math.random() * 3000 + 2000 )
    .easing( TWEEN.Easing.Quadratic.Out ).start();

    new TWEEN.Tween( light.position ).to( {
        x: ( Math.random() * 30 ) - 15,
        y: ( Math.random() * 10 ) + 30,
        z: ( Math.random() * 30 ) - 15
    }, Math.random() * 3000 + 2000 )
    .easing( TWEEN.Easing.Quadratic.Out ).start();
}
