import * as THREE from 'three'
import {VRButton} from "three/examples/jsm/webxr/VRButton"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader";
import {DRACOLoader} from "three/examples/jsm/loaders/DRACOLoader"

import clown from "../assets/clown.glb"
import knight from "../assets/knight.glb"
import exhausted from "../assets/exhausted.glb"
import blimp from "../assets/blimp.glb"
import CYBER from "../assets/CYBER.glb"
import {XRHandModelFactory} from "three/examples/jsm/webxr/XRHandModelFactory";
import { World, System, Component, TagComponent, Types } from "three/examples/jsm/libs/ecsy.module";
import {createText} from "three/examples/jsm/webxr/Text2D";
import {OculusHandModel} from "three/examples/jsm/webxr/OculusHandModel";
import {XRControllerModelFactory} from "three/examples/jsm/webxr/XRControllerModelFactory";

class Object3D extends Component { }

Object3D.schema = {
  object: { type: Types.Ref }
};

class Button extends Component { }

Button.schema = {
  // button states: [resting, pressed, fully_pressed, recovering]
  currState: { type: Types.String, default: 'resting' },
  prevState: { type: Types.String, default: 'resting' },
  pressSound: { type: Types.Ref, default: null },
  releaseSound: { type: Types.Ref, default: null },
  restingY: { type: Types.Number, default: null },
  surfaceY: { type: Types.Number, default: null },
  recoverySpeed: { type: Types.Number, default: 0.4 },
  fullPressDistance: { type: Types.Number, default: null },
  action: { type: Types.Ref, default: () => { } }
};

class ButtonSystem extends System {

  init( attributes ) {

    this.renderer = attributes.renderer;
    this.soundAdded = false;

  }

  execute( /*delta, time*/ ) {

    let buttonPressSound, buttonReleaseSound;
    if ( this.renderer.xr.getSession() && ! this.soundAdded ) {

      const xrCamera = this.renderer.xr.getCamera();

      const listener = new THREE.AudioListener();
      xrCamera.add( listener );

      // create a global audio source
      buttonPressSound = new THREE.Audio( listener );
      buttonReleaseSound = new THREE.Audio( listener );

      // load a sound and set it as the Audio object's buffer
      const audioLoader = new THREE.AudioLoader();
      audioLoader.load( 'sounds/button-press.ogg', function ( buffer ) {

        buttonPressSound.setBuffer( buffer );

      } );
      audioLoader.load( 'sounds/button-release.ogg', function ( buffer ) {

        buttonReleaseSound.setBuffer( buffer );

      } );
      this.soundAdded = true;

    }

    this.queries.buttons.results.forEach( entity => {

      const button = entity.getMutableComponent( Button );
      const buttonMesh = entity.getComponent( Object3D ).object;
      // populate restingY
      if ( button.restingY == null ) {

        button.restingY = buttonMesh.position.y;

      }

      if ( buttonPressSound ) {

        button.pressSound = buttonPressSound;

      }

      if ( buttonReleaseSound ) {

        button.releaseSound = buttonReleaseSound;

      }

      if ( button.currState == 'fully_pressed' && button.prevState != 'fully_pressed' ) {

        button.pressSound?.play();
        button.action();

      }

      if ( button.currState == 'recovering' && button.prevState != 'recovering' ) {

        button.releaseSound?.play();

      }

      // preserve prevState, clear currState
      // FingerInputSystem will update currState
      button.prevState = button.currState;
      button.currState = 'resting';

    } );

  }

}


ButtonSystem.queries = {
  buttons: {
    components: [ Button ]
  }
};

class Pressable extends TagComponent { }

class FingerInputSystem extends System {

  init( attributes ) {

    this.hands = attributes.hands;

  }


  execute( delta/*, time*/ ) {

    this.queries.pressable.results.forEach( entity => {

      const button = entity.getMutableComponent( Button );
      const object = entity.getComponent( Object3D ).object;
      const pressingDistances = [];
      this.hands.forEach( hand => {

        if ( hand && hand.intersectBoxObject( object ) ) {

          const pressingPosition = hand.getPointerPosition();
          pressingDistances.push( button.surfaceY - object.worldToLocal( pressingPosition ).y );

        }

      } );
      if ( pressingDistances.length == 0 ) { // not pressed this frame

        if ( object.position.y < button.restingY ) {

          object.position.y += button.recoverySpeed * delta;
          button.currState = 'recovering';

        } else {

          object.position.y = button.restingY;
          button.currState = 'resting';

        }

      } else {

        button.currState = 'pressed';
        const pressingDistance = Math.max( pressingDistances );
        if ( pressingDistance > 0 ) {

          object.position.y -= pressingDistance;

        }

        if ( object.position.y <= button.restingY - button.fullPressDistance ) {

          button.currState = 'fully_pressed';
          object.position.y = button.restingY - button.fullPressDistance;

        }

      }

    } );

  }

}

FingerInputSystem.queries = {
  pressable: {
    components: [ Pressable ]
  }
};

class Rotating extends TagComponent { }

class RotatingSystem extends System {

    execute( delta/*, time*/ ) {

        this.queries.rotatingObjects.results.forEach( entity => {

            const object = entity.getComponent( Object3D ).object;
            object.rotation.x += 0.4 * delta;
            object.rotation.y += 0.4 * delta;

        } );

    }

}

RotatingSystem.queries = {
    rotatingObjects: {
        components: [ Rotating ]
    }
};

class HandsInstructionText extends TagComponent { }

class InstructionSystem extends System {

  init( attributes ) {

    this.controllers = attributes.controllers;

  }

  execute( /*delta, time*/ ) {

    let visible = false;
    this.controllers.forEach( controller => {

      if ( controller.visible ) {

        visible = true;

      }

    } );

    this.queries.instructionTexts.results.forEach( entity => {

      const object = entity.getComponent( Object3D ).object;
      object.visible = visible;

    } );

  }

}

InstructionSystem.queries = {
  instructionTexts: {
    components: [ HandsInstructionText ]
  }
};

class App {
  clown = {}
  spheres = [];
  tmpVector1 = new THREE.Vector3();
  tmpVector2 = new THREE.Vector3();

   grabbing = false;
   scaling = {
    active: false,
    initialDistance: 0,
    object: null,
    initialScale: 1
  };


  world = new World();

  clock = new THREE.Clock();

  scene
  renderer;
  controller1;
  controller2;

  constructor() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    this.camera = new THREE.PerspectiveCamera(50,
        window.innerWidth / window.innerHeight, 0.1, 200)
    this.camera.position.set(0, 1.6, 3)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x505050)

    const ambient = new THREE.HemisphereLight(0x606060, 0x404040, 1)
    this.scene.add(ambient)

    const light = new THREE.DirectionalLight(0xffffff)
    light.position.set(1, 1, 1).normalize()
    this.scene.add(light)



    this.renderer = new THREE.WebGLRenderer({antialias: true})
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(this.renderer.domElement)

    this.initScene()
    this.setupVR()

    this.renderer.setAnimationLoop(this.render.bind(this))
    window.addEventListener('resize', this.resize.bind(this))
  }


  initScene() {

    const self = this

    const geometry = new THREE.BoxBufferGeometry(.5, .5, .5)
    const material = new THREE.MeshStandardMaterial({color: 0xFF0000})
    this.mesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.mesh)

    const geometrySphere = new THREE.SphereGeometry(.7, 32, 16)
    const materialSphere = new THREE.MeshBasicMaterial({color: 0xffff00})
    const sphere = new THREE.Mesh(geometrySphere, materialSphere)
    this.scene.add(sphere)

    sphere.position.set(1.5, 0, 0)


    this.loadAsset(blimp,  gltf => {
      const gltfScene = gltf.scene
      self.scene.add(gltfScene)
      gltfScene.position.set(4, 1, -5)
      const scale = 5
      gltfScene.scale.set(scale, scale, scale)
      self.blimp = gltfScene
    })

    this.loadAsset(clown,  gltf => {
      const gltfScene = gltf.scene
      self.scene.add(gltfScene)
      gltfScene.position.set(5,1, -5)
      const scale = 1
      gltfScene.scale.set(scale, scale, scale)
      this.clown = gltfScene
    })

    this.loadAsset(knight, gltf => {
      const gltfScene = gltf.scene.children[0]
      gltfScene.position.set(-5,1, -5)

      self.knight = gltfScene
      const scale = 1;
      self.knight.scale.set(scale, scale, scale);

      self.scene.add(gltfScene)

      // animations
      self.animations = {};

      gltf.animations.forEach( (anim)=>{
        self.animations[anim.name] = anim;
      })

      self.mixer = new THREE.AnimationMixer(self.knight)
      self.action = "exhausted";
    })



    this.loadAsset(CYBER,  gltf => {
      const gltfScene = gltf.scene
      self.scene.add(gltfScene)
      gltfScene.position.set(-5, -.05, -20)
      const scale = 5
      gltfScene.scale.set(scale, scale, scale)
      this.CYBER = gltfScene
      this.CYBER.visible = false
    })

  }


  loadAsset(gltfFilename, sceneHandler) {
    const self = this
    const loader = new GLTFLoader()
    // Provide a DRACOLoader instance to decode compressed mesh data
    const draco = new DRACOLoader()
    draco.setDecoderPath('draco/')
    loader.setDRACOLoader(draco)

    loader.load(gltfFilename, (gltf) => {
          if (sceneHandler) {
            sceneHandler(gltf)
          }
        },
        null,
        (error) => console.error(`An error happened: ${error}`)
    )
  }






  makeButtonMesh( x, y, z, color ) {

    const geometry = new THREE.BoxGeometry( x, y, z );
    const material = new THREE.MeshPhongMaterial( { color: color } );
    const buttonMesh = new THREE.Mesh( geometry, material );
    buttonMesh.castShadow = true;
    buttonMesh.receiveShadow = true;
    return buttonMesh;

  }

  set action(name){
    if (this.actionName === name) return;

    const clip = this.animations[name];

    if (clip !== undefined) {
      const action = this.mixer.clipAction(clip);

      if (name === 'walk') {
        action.loop = THREE.LoopOnce;
        action.clampWhenFinished = true;
      }

      this.actionName = name;
      if (this.curAction) this.curAction.crossFadeTo(action, 0.5);

      action.enabled = true;
      action.play();

      this.curAction = action;
    }
  }

  setupVR() {


    this.renderer.xr.enabled = true
    document.body.appendChild(VRButton.createButton(this.renderer))
    /* const grip = this.renderer.xr.getControllerGrip(0)
     grip.add(new XRControllerModelFactory().createControllerModel(grip))
     this.scene.add(grip)
     const grip2 = this.renderer.xr.getControllerGrip(1)
     grip2.add(new XRControllerModelFactory().createControllerModel(grip2))
     this.scene.add(grip2)
 */

    class OffsetFromCamera extends Component { }

    OffsetFromCamera.schema = {
      x: { type: Types.Number, default: 0 },
      y: { type: Types.Number, default: 0 },
      z: { type: Types.Number, default: 0 },
    };


    class NeedCalibration extends TagComponent { }

    class CalibrationSystem extends System {

      init( attributes ) {

        this.camera = attributes.camera;
        this.renderer = attributes.renderer;
        this.clown = attributes.clown

      }

      execute( /*delta, time*/ ) {

        this.queries.needCalibration.results.forEach( entity => {

          if ( this.renderer.xr.getSession() ) {

            const offset = entity.getComponent( OffsetFromCamera );
            const object = entity.getComponent( Object3D ).object;
            const xrCamera = this.renderer.xr.getCamera();
            object.position.x = xrCamera.position.x + offset.x;
            object.position.y = xrCamera.position.y + offset.y;
            object.position.z = xrCamera.position.z + offset.z;
            entity.removeComponent( NeedCalibration );

          }

        } );

      }

    }

    CalibrationSystem.queries = {
      needCalibration: {
        components: [ NeedCalibration ]
      }
    };

    const controller1 = this.renderer.xr.getController( 0 );
    this.scene.add( controller1 );
    this.controller1 = controller1

    const controller2 = this.renderer.xr.getController( 1 );
    this.scene.add( controller2 );
    this.controller2 = controller2

    const controllerModelFactory = new XRControllerModelFactory();

    // Hand 1
    const controllerGrip1 = this.renderer.xr.getControllerGrip( 0 );
    controllerGrip1.add( controllerModelFactory.createControllerModel( controllerGrip1 ) );
    this.scene.add( controllerGrip1 );

    const hand1 = this.renderer.xr.getHand( 0 );
    const handModel1 = new OculusHandModel( hand1 );
    hand1.add( handModel1 );
    this.scene.add( hand1 );
    this.hand1 = hand1

    // Hand 2
    const controllerGrip2 = this.renderer.xr.getControllerGrip( 1 );
    controllerGrip2.add( controllerModelFactory.createControllerModel( controllerGrip2 ) );
    this.scene.add( controllerGrip2 );

    const hand2 = this.renderer.xr.getHand( 1 );
    const handModel2 = new OculusHandModel( hand2 );
    hand2.add( handModel2 );
    this.hand2 = hand2;
    this.scene.add( hand2 );


    const floorGeometry = new THREE.PlaneGeometry( 4, 4 );
    const floorMaterial = new THREE.MeshPhongMaterial( { color: 0x222222 } );
    const floor = new THREE.Mesh( floorGeometry, floorMaterial );
    floor.rotation.x = - Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add( floor );

    const consoleGeometry = new THREE.BoxGeometry( 0.65, 0.12, 0.15 );
    const consoleMaterial = new THREE.MeshPhongMaterial( { color: 0x595959 } );
    const consoleMesh = new THREE.Mesh( consoleGeometry, consoleMaterial );
    consoleMesh.position.set( 0, 1, - 0.3 );
    consoleMesh.castShadow = true;
    consoleMesh.receiveShadow = true;
    this.scene.add( consoleMesh );

    const orangeButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0xffd3b5 );
    orangeButton.position.set( - 0.15, 0.04, 0 );
    consoleMesh.add( orangeButton );

    const pinkButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0xe84a5f );
    pinkButton.position.set( - 0.05, 0.04, 0 );
    consoleMesh.add( pinkButton );

    const addButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0xe84a5f );
    const addButtonText = createText( 'add????', 0.03 );
    addButton.position.set( - 0.05, 0.04, 0 );
    consoleMesh.add( addButton );
    addButton.add( addButtonText );
    addButtonText.rotation.x = - Math.PI / 2;
    addButtonText.position.set( 0, 0.051, 0 );
    addButton.position.set( 0.25, 0.04, 0 );
    consoleMesh.add( addButton );


    const downButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0x355c7d );
    const downButtonText = createText( 'Down', 0.03 );
    downButton.add( downButtonText );
    downButtonText.rotation.x = - Math.PI / 2;
    downButtonText.position.set( 0, 0.051, 0 );
    downButton.position.set( 0.05, 0.04, 0 );
    consoleMesh.add( downButton );

    const UpButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0xff0000 );
    const UpButtonText = createText( 'Up', 0.03 );
    UpButton.add( UpButtonText );
    UpButtonText.rotation.x = - Math.PI / 2;
    UpButtonText.position.set( 0, 0.051, 0 );
    UpButton.position.set( 0.15, 0.04, 0 );
    consoleMesh.add( UpButton );

    const resetButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0x355c7d );
    const resetButtonText = createText( 'reset', 0.03 );
    resetButton.add( resetButtonText );
    resetButtonText.rotation.x = - Math.PI / 2;
    resetButtonText.position.set( 0, 0.051, 0 );
    resetButton.position.set( -0.25, 0.04, 0 );
    consoleMesh.add( resetButton );

    const tkGeometry = new THREE.TorusKnotGeometry( 0.5, 0.2, 200, 32 );
    const tkMaterial = new THREE.MeshPhongMaterial( { color: 0xffffff } );
    tkMaterial.metalness = 0.8;
    const torusKnot = new THREE.Mesh( tkGeometry, tkMaterial );
    torusKnot.position.set( 0, 3, - 5 );
    torusKnot.visible = true
    this.scene.add( torusKnot );

    const instructionText = createText( 'This is a WebXR Hands demo, please explore with hands.', 0.04 );
    instructionText.position.set( 0, 1.6, - 0.6 );
    this.scene.add( instructionText );

    const UpText = createText( '', 0.04 );
    UpText.position.set( 0, 1.5, - 0.6 );
    UpText.visible = false;
    this.scene.add( UpText );

    this.world
        .registerComponent(Object3D)
        .registerComponent(Button)
        .registerComponent(Pressable)
        .registerComponent(Rotating)
        .registerComponent(HandsInstructionText)
        .registerComponent(OffsetFromCamera)
        .registerComponent(NeedCalibration);

    this.world
        .registerSystem(RotatingSystem)
        .registerSystem(CalibrationSystem, {renderer: this.renderer, camera: this.camera, clown: this.clown})
        .registerSystem(ButtonSystem, {renderer: this.renderer, camera: this.camera})
        .registerSystem(FingerInputSystem, {hands: [handModel1, handModel2]});

    const csEntity = this.world.createEntity();
    csEntity.addComponent( OffsetFromCamera, { x: 0, y: - 0.4, z: - 0.3 } );
    csEntity.addComponent( NeedCalibration );
    csEntity.addComponent( Object3D, { object: consoleMesh } );

    const obEntity = this.world.createEntity();
    obEntity.addComponent( Pressable );
    obEntity.addComponent( Object3D, { object: orangeButton } );
    const obAction = function () {

      torusKnot.material.color.setHex( 0xffd3b5 );

    };

    obEntity.addComponent( Button, { action: obAction, surfaceY: 0.05, fullPressDistance: 0.02 } );

    const pbEntity = this.world.createEntity();
    pbEntity.addComponent( Pressable );
    pbEntity.addComponent( Object3D, { object: pinkButton } );
    const pbAction = function () {

      torusKnot.material.color.setHex( 0xe84a5f );

    };

    pbEntity.addComponent( Button, { action: pbAction, surfaceY: 0.05, fullPressDistance: 0.02 } );

    const rbEntity = this.world.createEntity();
    rbEntity.addComponent( Pressable );
    rbEntity.addComponent( Object3D, { object: downButton } );
    const rbAction = function () {

      UpText.visible = true;
      self.clown.translateY(-.1)
      console.debug('Reset button pressed')

    };
    const self = this
    rbEntity.addComponent( Button, { action: rbAction, surfaceY: 0.05, fullPressDistance: 0.02 } );

    const ebEntity = this.world.createEntity();
    ebEntity.addComponent( Pressable );
    ebEntity.addComponent( Object3D, { object: UpButton } );
    const ebAction = function () {

      UpText.visible = true;
             self.clown.translateY(.1)
             console.debug('Exit button pressed')
    };

    const asEntity = this.world.createEntity();
    asEntity.addComponent( Pressable );
    asEntity.addComponent( Object3D, { object: resetButton } );
    const asAction = function () {

      resetButtonText.visible = true;
      self.CYBER.visible = false
      self.clown.position.set( 5,1, -5 )
      torusKnot.material.color.setHex( 0xffffff );
      console.debug('reseted')
    };

    asEntity.addComponent( Button, { action: asAction, surfaceY: 0.05, fullPressDistance: 0.02 } );

    const jdEntity = this.world.createEntity();
    jdEntity.addComponent( Pressable );
    jdEntity.addComponent( Object3D, { object: addButton } );
    const jdAction = function () {

      addButtonText.visible = true;
      self.CYBER.visible = true
      console.debug('Done!')

    };
    jdEntity.addComponent( Button, { action: jdAction, surfaceY: 0.05, fullPressDistance: 0.02 } );



    ebEntity.addComponent( Button, { action: ebAction, surfaceY: 0.05, recoverySpeed: 0.2, fullPressDistance: 0.03 } );

    const tkEntity = this.world.createEntity();
    tkEntity.addComponent( Rotating );
    tkEntity.addComponent( Object3D, { object: torusKnot } );

    const itEntity = this.world.createEntity();
    itEntity.addComponent( HandsInstructionText );
    itEntity.addComponent( Object3D, { object: instructionText } );

    window.addEventListener( 'resize', onWindowResize );


    function onWindowResize() {

      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();

      renderer.setSize( window.innerWidth, window.innerHeight );
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      renderer.xr.enabled = true;
      renderer.xr.cameraAutoUpdate = false;

      container.appendChild( renderer.domElement );

      document.body.appendChild( VRButton.createButton( renderer ) );

    }

    this.addActions()
  }


  addActions() {
    const self = this;

    this.controller1.addEventListener('selectstart', () => {
      self.action = 'exhausted'
    })

    this.controller1.addEventListener('squeezestart', () => {
      self.action = 'Walk'
    })

    this.controller2.addEventListener('selectstart', () => {
      self.action = 'kick'
    })

    this.controller2.addEventListener('squeezestart', () => {
      self.action = 'spider'
    })

  }


  animate() {

    renderer.setAnimationLoop( this.render );

  }


  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  render() {

    const delta = this.clock.getDelta();
    const elapsedTime =  this.clock.elapsedTime;
    this.renderer.xr.updateCamera( this.camera );
    if (elapsedTime > 10) {
      this.world.execute( delta, elapsedTime );
    }
    this.renderer.render(  this.scene, this.camera );

    if (this.mixer) {
      this.mixer.update(delta)
    }

    this.renderer.render(this.scene, this.camera)
  }
}

export {App}