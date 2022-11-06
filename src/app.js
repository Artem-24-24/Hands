import * as THREE from 'three'
import {VRButton} from "three/examples/jsm/webxr/VRButton"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader";
import {DRACOLoader} from "three/examples/jsm/loaders/DRACOLoader"
//import {XRControllerModelFactory} from "three/examples/jsm/webxr/XRControllerModelFactory";

import clown from "../assets/clown.glb"
import blimp from "../assets/blimp.glb"
import {XRHandModelFactory} from "three/examples/jsm/webxr/XRHandModelFactory";
import { World, System, Component, TagComponent, Types } from "three/examples/jsm/libs/ecsy.module";
import {createText} from "three/examples/jsm/webxr/Text2D";

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
   camera
   scene
   renderer
  clock = new THREE.Clock();
  SphereRadius = 0.05;

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


    this.loadAsset(blimp, 5, .5, -5, scene => {
      const scale = 5
      scene.scale.set(scale, scale, scale)
      self.blimp = scene
    })
    //
    // this.loadAsset(chair, .5, .5, 1, scene => {
    //   const scale = 1
    //   scene.scale.set(scale, scale, scale)
    //   self.chair = scene
    // })

    this.loadAsset(clown, 0, .5, -5, scene => {
      const scale = 1
      scene.scale.set(scale, scale, scale)
      self.clown = scene
    })

  }

  loadAsset(gltfFilename, x, y, z, sceneHandler) {
    const self = this
    const loader = new GLTFLoader()
    // Provide a DRACOLoader instance to decode compressed mesh data
    const draco = new DRACOLoader()
    draco.setDecoderPath('draco/')
    loader.setDRACOLoader(draco)

    loader.load(gltfFilename, (gltf) => {
          const gltfScene = gltf.scene
          self.scene.add(gltfScene)
          gltfScene.position.set(x, y, z)
          if (sceneHandler) {
            sceneHandler(gltfScene)
          }
        },
        null,
        (error) => console.error(`An error happened: ${error}`)
    )
  }


  // changeAngle(handedness) {
  //   if (this.clown) {
  //     this.clown.rotateY(15)
  //   }
  // }
  //
  // changePosition(handedness) {
  //   if (this.blimp) {
  //    const pos = this.blimp.position
  //     this.blimp.position.set(pos.x -0.5, pos.y, pos.z)
  //   }
  // }
  Rotating;

  makeButtonMesh( x, y, z, color ) {

    const geometry = new THREE.BoxGeometry( x, y, z );
    const material = new THREE.MeshPhongMaterial( { color: color } );
    const buttonMesh = new THREE.Mesh( geometry, material );
    buttonMesh.castShadow = true;
    buttonMesh.receiveShadow = true;
    return buttonMesh;

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

    const consoleGeometry = new THREE.BoxGeometry(0.5, 0.12, 0.15);
    const consoleMaterial = new THREE.MeshPhongMaterial({color: 0x595959});
    const consoleMesh = new THREE.Mesh(consoleGeometry, consoleMaterial);
    consoleMesh.position.set(0, 1, -0.3);
    consoleMesh.castShadow = true;
    consoleMesh.receiveShadow = true;
    this.scene.add(consoleMesh);

    const orangeButton = this.makeButtonMesh( 0.08, 0.1, 0.08, 0xffd3b5 );
    orangeButton.position.set( - 0.15, 0.04, 0 );
    consoleMesh.add( orangeButton );

    const pinkButton = this.makeButtonMesh(0.08, 0.1, 0.08, 0xe84a5f);
    pinkButton.position.set(-0.05, 0.04, 0);
    consoleMesh.add(pinkButton);

    const resetButton = this.makeButtonMesh(0.08, 0.1, 0.08, 0x355c7d);
    const resetButtonText = createText('reset', 0.03);
    resetButton.add(resetButtonText);
    resetButtonText.rotation.x = -Math.PI / 2;
    resetButtonText.position.set(0, 0.051, 0);
    resetButton.position.set(0.05, 0.04, 0);
    consoleMesh.add(resetButton);

    const exitButton = this.makeButtonMesh(0.08, 0.1, 0.08, 0xff0000);
    const exitButtonText = createText('exit', 0.03);
    exitButton.add(exitButtonText);
    exitButtonText.rotation.x = -Math.PI / 2;
    exitButtonText.position.set(0, 0.051, 0);
    exitButton.position.set(0.15, 0.04, 0);
    consoleMesh.add(exitButton);

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

    const tkGeometry = new THREE.TorusKnotGeometry(0.5, 0.2, 200, 32);
    const tkMaterial = new THREE.MeshPhongMaterial({color: 0xffffff});
    tkMaterial.metalness = 0.8;
    const torusKnot = new THREE.Mesh(tkGeometry, tkMaterial);
    torusKnot.position.set(0, 1, -5);
    this.scene.add(torusKnot);

    const instructionText = createText('This is a WebXR Hands demo, please explore with hands.', 0.04);
    instructionText.position.set(0, 1.6, -0.6);
    this.scene.add(instructionText);


    const exitText = createText('Exiting session...', 0.04);
    exitText.position.set(0, 1.5, -0.6);
    exitText.visible = false;
    this.scene.add(exitText);

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
        .registerSystem(CalibrationSystem, {renderer: this.renderer, camera: this.camera})
        .registerSystem(ButtonSystem, {renderer: this.renderer, camera: this.camera})
        .registerSystem(FingerInputSystem, {hands: [this.hand1, this.hand2]});

    const csEntity = this.world.createEntity();
    csEntity.addComponent(OffsetFromCamera, {x: 0, y: -0.4, z: -0.3});
    csEntity.addComponent(NeedCalibration);
    csEntity.addComponent(Object3D, {object: consoleMesh});

    const obEntity = this.world.createEntity();
    obEntity.addComponent(Pressable);
    obEntity.addComponent(Object3D, {object: orangeButton});
    const obAction = function () {

      torusKnot.material.color.setHex(0xffd3b5);

    };

    obEntity.addComponent(Button, {action: obAction, surfaceY: 0.05, fullPressDistance: 0.02});

    const pbEntity = this.world.createEntity();
    pbEntity.addComponent(Pressable);
    pbEntity.addComponent(Object3D, {object: pinkButton});
    const pbAction = function () {

      torusKnot.material.color.setHex(0xe84a5f);

    };

    pbEntity.addComponent(Button, {action: pbAction, surfaceY: 0.05, fullPressDistance: 0.02});

    const rbEntity = this.world.createEntity();
    rbEntity.addComponent(Pressable);
    rbEntity.addComponent(Object3D, {object: resetButton});
    const rbAction = function () {

      torusKnot.material.color.setHex(0xffffff);

    };

    rbEntity.addComponent(Button, {action: rbAction, surfaceY: 0.05, fullPressDistance: 0.02});

    const ebEntity = this.world.createEntity();
    ebEntity.addComponent(Pressable);
    ebEntity.addComponent(Object3D, {object: exitButton});
    const ebAction = function () {

      exitText.visible = true;
      setTimeout(function () {

        exitText.visible = false;
        renderer.xr.getSession().end();

      }, 2000);

    };
    function onWindowResize() {

      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();

      renderer.setSize( window.innerWidth, window.innerHeight );

    }

    ebEntity.addComponent(Button, {action: ebAction, surfaceY: 0.05, recoverySpeed: 0.2, fullPressDistance: 0.03});

    const tkEntity = this.world.createEntity();
    tkEntity.addComponent(Rotating);
    tkEntity.addComponent(Object3D, {object: torusKnot});

    const itEntity = this.world.createEntity();
    itEntity.addComponent(HandsInstructionText);
    itEntity.addComponent(Object3D, {object: instructionText});

    window.addEventListener('resize', onWindowResize);


    const hand1 = this.renderer.xr.getHand(0)
    hand1.add(new XRHandModelFactory().createHandModel(hand1, "mesh"))
    this.scene.add(hand1)
    // hand1.addEventListener('selectstart',  evt => {
    //   self.changeAngle.bind(self, evt.handedness ).call();
    // } )

    const hand2 = this.renderer.xr.getHand(1)
    hand2.add(new XRHandModelFactory().createHandModel(hand2, "mesh"))
    this.scene.add(hand2);

    this.hand1 = hand1
    this.hand2 = hand2
  }

  //
  //
  //   const self = this
  //
  //   hand1.addEventListener( 'pinchstart', event => {
  //     self.onPinchStartLeft.bind(self, event).call()
  //   } );
  //   hand1.addEventListener( 'pinchend', () => {
  //     self.scaling.active = false;
  //   } );
  //
  //   hand2.addEventListener( 'pinchstart', (event) => {
  //     self.onPinchStartRight.bind(self, event).call()
  //   } );
  //   hand2.addEventListener( 'pinchend',  (event) => {
  //     self.onPinchEndRight.bind(self, event).call()
  //   } )
  // }

  // onPinchStartLeft( event ) {
  //
  //   const controller = event.target;
  //
  //   if ( this.grabbing ) {
  //
  //     const indexTip = controller.joints[ 'index-finger-tip' ];
  //     const sphere = this.collideObject( indexTip );
  //
  //     if ( sphere ) {

    //     const sphere2 = this.hand2.userData.selected;
    //     console.log( 'sphere1', sphere, 'sphere2', sphere2 );
    //     if ( sphere === sphere2 ) {
    //
    //       this.scaling.active = true;
    //       this.scaling.object = sphere;
    //       this.scaling.initialScale = sphere.scale.x;
    //       this.scaling.initialDistance = indexTip.position.distanceTo( this.hand2.joints[ 'index-finger-tip' ].position );
    //       return;
    //
    //     }
    //
    //   }
    //
    // }

  //   const geometry = new THREE.BoxGeometry( this.SphereRadius, this.SphereRadius, this.SphereRadius );
  //   const material = new THREE.MeshStandardMaterial( {
  //     color: Math.random() * 0xffffff,
  //     roughness: 1.0,
  //     metalness: 0.0
  //   } );
  //   const spawn = new THREE.Mesh( geometry, material );
  //   spawn.geometry.computeBoundingSphere();
  //
  //   const indexTip = controller.joints[ 'index-finger-tip' ];
  //   spawn.position.copy( indexTip.position );
  //   spawn.quaternion.copy( indexTip.quaternion );
  //
  //   this.spheres.push( spawn );
  //
  //   this.scene.add( spawn );
  //
  // }

  // onPinchStartRight( event ) {
  //
  //   const controller = event.target;
  //   const indexTip = controller.joints[ 'index-finger-tip' ];
  //   const object = this.collideObject( indexTip );
  //   if ( object ) {
  //
  //     this.grabbing = true;
  //     indexTip.attach( object );
  //     controller.userData.selected = object;
  //     console.log( 'Selected', object );
  //
  //   }
  //
  // }
  //
  //
  //
  // onPinchEndRight( event ) {
  //
  //   const controller = event.target;
  //
  //   if ( controller.userData.selected !== undefined ) {
  //
  //     const object = controller.userData.selected;
  //     object.material.emissive.b = 0;
  //     this.scene.attach( object );
  //
  //     controller.userData.selected = undefined;
  //     this.grabbing = false;
  //
  //   }
  //
  //   this.scaling.active = false;
  //
  // }

  // collideObject( indexTip ) {
  //
  //   for ( let i = 0; i < this.spheres.length; i ++ ) {
  //
  //     const sphere = this.spheres[ i ];
  //     const distance = indexTip.getWorldPosition( this.tmpVector1 ).distanceTo( sphere.getWorldPosition( this.tmpVector2 ) );
  //
  //     if ( distance < sphere.geometry.boundingSphere.radius * sphere.scale.x ) {
  //
  //       return sphere;
  //
  //     }
  //
  //   }
  //
  //   return null;
  //
  // }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  render() {

    const delta = this.clock.getDelta();
    const elapsedTime =  this.clock.elapsedTime;
    this.renderer.xr.updateCamera( this.camera );
    this.world.execute( delta, elapsedTime );
    this.renderer.render(  this.scene, this.camera );

    if ( this.scaling.active ) {

      const indexTip1Pos = this.hand1.joints[ 'index-finger-tip' ].position;
      const indexTip2Pos = this.hand2.joints[ 'index-finger-tip' ].position;
      const distance = indexTip1Pos.distanceTo( indexTip2Pos );
      const newScale = this.scaling.initialScale + distance / this.scaling.initialDistance - 1;
      this.scaling.object.scale.setScalar( newScale );

    }

    /*if (this.fork) {
      this.fork.rotateY(0.1 * xAxis)
      this.fork.translateY(.02 * yAxis)
    }*/

    this.renderer.render(this.scene, this.camera)
  }
}

export {App}