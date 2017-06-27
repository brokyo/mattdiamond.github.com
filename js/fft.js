var fileReader = new FileReader(),
	context = new AudioContext(),
	getUserMedia = (navigator.getUserMedia
					|| navigator.webkitGetUserMedia
					|| navigator.mozGetUserMedia
					|| navigator.msGetUserMedia).bind(navigator);

var source, fftWorker;

var wavesurfer;

const WORKER_PATH = 'js/fft-worker.js';

fileReader.onload = function(){
	reset();
	output('decoding...');
	context.decodeAudioData(fileReader.result, processBuffer);
};

$(function(){
	var app = new App();

//	bindFileInput();
//	bindControls();
//	setupWavesurfer();
	//getUserMedia({ audio: true }, setUpMediaRecorder, function(){});
});

function spawnWorker(){
	var worker = new Worker('js/fft-worker.js');
	worker.onmessage = messageHandler;
	return worker;
}

function reset(){
	if (source){
		source.stop();
		source.disconnect();
	}
	$('#output').empty();
}

function setUpMediaRecorder(stream){
	var record = document.getElementById('record'),
		stop = document.getElementById('stop'),
		source = context.createMediaStreamSource(stream),
		recorder = context.createScriptProcessor(),
		recording = false, chunkSize = recorder.bufferSize,
		inputL, inputR;

	source.connect(recorder);
	recorder.connect(context.destination);

	record.onclick = function(){
		output('recording');
		inputL = inputR = [];
		recording = true;
	};

	stop.onclick = function(){
		recording = false;

		var arrayLength = inputL.length,
			bufferLength = chunkSize * arrayLength,
			buffer = context.createBuffer(2, bufferLength, context.sampleRate);

		for (var i = 0; i < arrayLength; i++){
			buffer.copyToChannel(inputL[i], 0, i * chunkSize);
			buffer.copyToChannel(inputR[i], 1, i * chunkSize);
		}

		processBuffer(buffer);
	};

	recorder.onaudioprocess = function(e){
		if (!recording) return;
		inputL.push(e.inputBuffer.getChannelData(0));
		inputR.push(e.inputBuffer.getChannelData(1));
	};
}

function bindFileInput(){
	var fileInput = document.getElementById('FileInput');
	fileInput.onchange = function(){
		var file = this.files[0];
		fileReader.readAsArrayBuffer(file);
	};
}

function bindControls(){
	$('#play-selection').click(playSelection);
	$('#process-selection').click(processSelection);
	$('#reset').click(reset);
}

var selection, audioBuffer;

function processBuffer(buffer){
	audioBuffer = buffer;

	wavesurfer.loadDecodedBuffer(buffer);
	wavesurfer.enableDragSelection({});
	wavesurfer.on('region-update-end', region => {
		wavesurfer.stop();
		if (selection && selection !== region) selection.remove();
		selection = region;
	});
}

class App {
	constructor(){
		this.context = new AudioContext();
		this.editor = new Editor();
		this.setupFileReader();
		this.setupControls();
	}

	setupFileReader(){
		this.fileReader = new FileReader();
		this.fileReader.onload = () => {
			this.output('decoding...');
			this.context.decodeAudioData(this.fileReader.result).then(buffer => {
				this.editor.loadBuffer(buffer);
			});
		};
	}

	setupControls(){
		this.$fileInput = $('#FileInput');
		this.$fileInput.on('change', () => {
			var file = this.$fileInput[0].files[0];
			if (file) this.fileReader.readAsArrayBuffer(file);
		});

		$('[data-action="play-selection"]').click(() => {
			this.editor.playSelection();
		});

		$('[data-action="stop-selection"]').click(() => {
			this.editor.stop();
		});

		$('[data-action="process-selection"]').click(() => {
			this.processSelection();
		});

		$('[data-action="stop-fft-playback"]').click(() => {
			this.stopBufferSource();
		});
	}

	processSelection(){
		this.spawnFFTWorker();

		var selection = this.editor.selection;

		this.fftWorker.postMessage({
			left: selection.getChannelData(0),
			right: selection.getChannelData(1)
		});
	}

	spawnFFTWorker(){
		if (this.fftWorker) this.fftWorker.terminate();

		this.fftWorker = new Worker(WORKER_PATH);
		this.fftWorker.onmessage = this.workerMessageHandler.bind(this);
	}

	workerMessageHandler(e){
		if (e.data.type === 'update'){
			this.output(e.data.update);
			return;
		}

		this.playFFTOutput(e.data.left, e.data.right);
	}

	output(text){
		$('#output').text(text);
	}

	playFFTOutput(left, right){
		var context = this.context;
		var outputBuffer = context.createBuffer(2, left.length, context.sampleRate);
		outputBuffer.copyToChannel(left, 0);
		outputBuffer.copyToChannel(right, 1);

		this.stopBufferSource();

		this.bufferSource = context.createBufferSource();
		this.bufferSource.buffer = outputBuffer;
		this.bufferSource.loop = true;
		this.bufferSource.connect(context.destination);
		this.bufferSource.start();
	}

	stopBufferSource(){
		if (this.bufferSource){
			this.bufferSource.stop();
			this.bufferSource.disconnect();
		}
	}
}

class Editor {
	constructor(){
		this.wavesurfer = WaveSurfer.create({
			container: '#waveform'
		});
		this.wavesurfer.enableDragSelection({});
		this.wavesurfer.on('region-update-end', this.onRegionUpdated.bind(this));

		this.selection = this.createSelection();	//init empty selection

		this.$snapToPowerOf2 = $('[data-setting="snap-to-power-of-2"]');
	}

	createSelection(region){
		return new Selection(region, this);
	}

	playSelection(){
		this.selection.play();
	}

	stop(){
		this.wavesurfer.stop();
	}

	onRegionUpdated(region){
		this.stop();
		if (region !== this.selection.region){
			this.selection.remove();
			this.selection = this.createSelection(region);
		} else {	//modified existing region
			this.selection.update();
		}
	}

	loadBuffer(audioBuffer){
		this.audioBuffer = audioBuffer;
		this.wavesurfer.loadDecodedBuffer(this.audioBuffer);
	}

	getIndexFromTime(time){
		var buffer = this.audioBuffer;
		return Math.floor(time / buffer.duration * buffer.length);
	}

	getTimeFromIndex(index){
		var buffer = this.audioBuffer;
		return index / buffer.length * buffer.duration;
	}

	get snapToPowerOf2(){
		return this.$snapToPowerOf2.is(':checked');
	}
}

class Selection {
	constructor(region, editor){
		this.region = region;
		this.editor = editor;

		if (this.region){
			this.update();
		}
	}

	update(){
		this.calculateIndexes();
		if (this.editor.snapToPowerOf2){
			this.adjustToPowerOf2();
		}
	}

	play(){
		if (this.region) this.region.play();
	}

	getChannelData(channel){
		return this.editor.audioBuffer
				.getChannelData(channel)
				.subarray(this.start, this.end);
	}

	calculateIndexes(){
		this.start = this.editor.getIndexFromTime(this.region.start);
		this.end = this.editor.getIndexFromTime(this.region.end);
	}

	adjustToPowerOf2(){
		var origDuration = this.end - this.start,
			durations = getClosestPowersOf2(origDuration),
			higherGap = durations.higher - origDuration,
			lowerGap = origDuration - durations.lower,
			bufferLength = this.editor.audioBuffer.length;

		if (higherGap < lowerGap && (this.start + durations.higher <= bufferLength)){
			this.end = this.start + durations.higher;
		} else {
			this.end = this.start + durations.lower;
		}
		this.region.update({ end: this.editor.getTimeFromIndex(this.end) });
	}

	remove(){
		if (this.region) this.region.remove();
	}
}

function playSelection(){
	if (selection) selection.play();
}

//function modifyEnd(selection){
//	var totalDuration = wavesurfer.getDuration(),
//		bufferLength = audioBuffer.length,
//		start =
//
//	return Math.floor(selection.start / totalDuration * bufferLength)
//}

function getClosestPowersOf2(number){
	return {
		lower: Math.pow(2, Math.floor(Math.log2(number))),
		higher: Math.pow(2, Math.ceil(Math.log2(number)))
	};
}

function processSelection(){
	var totalDuration = wavesurfer.getDuration(),
		bufferLength = audioBuffer.length,
		start = Math.floor(selection.start / totalDuration * bufferLength),
		end = Math.floor(selection.end / totalDuration * bufferLength);

	if (fftWorker) fftWorker.terminate();

	fftWorker = spawnWorker();

	end = start + getLowerPowerOf2(end - start);

	var leftSelection = audioBuffer.getChannelData(0).slice(start, end),
		rightSelection = audioBuffer.getChannelData(1).slice(start, end);

	console.log('selection size:', leftSelection.length);

	fftWorker.postMessage({
		left: leftSelection,
		right: rightSelection
	});
}

function messageHandler(e){
	if (e.data.type === 'update'){
		output(e.data.update);
		return;
	}

	var left = e.data.left,
		right = e.data.right;

	var outputBuffer = context.createBuffer(2, left.length, context.sampleRate);
	outputBuffer.copyToChannel(left, 0);
	outputBuffer.copyToChannel(right, 1);

	if (source){
		source.stop();
		source.disconnect();
	}

	source = context.createBufferSource();
	source.buffer = outputBuffer;
	source.loop = true;
	source.connect(context.destination);
	source.start();
}

function output(text){
	$('#output').text(text);
}