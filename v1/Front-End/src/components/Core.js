import './Core.css';
import React, { useState, useEffect } from 'react';
import ControlButton from './Core/ControlButton';
import Home from './Core/Home';
import Upload from './Core/Upload';
import Files from './Core/Files';
import { Route, Switch, Link, useHistory } from 'react-router-dom';

function Core () {
    const [homeActive, setHomeActive] = useState(true);
    const [uploadActive, setUploadActive] = useState(false);
    const [filesActive, setFilesActive] = useState(false);
    let history = useHistory();

    useEffect(() => {
        let activeControlButton = localStorage.getItem('activeControlButton');
        setActiveControlButton(activeControlButton);
        if(activeControlButton !== 'home') {
            history.push('/' + activeControlButton);

        }else {
            history.push('/');
        }
    }, []);

    function disableAllActive() {
        if(homeActive) setHomeActive(false);
        if(uploadActive) setUploadActive(false);
        if(filesActive) setFilesActive(false);
    }    

    function setActiveControlButton(buttonName){
        disableAllActive();
        if(buttonName === "home") setHomeActive(true);
        if(buttonName ==="upload") setUploadActive(true);
        if(buttonName === "files") setFilesActive(true);
        localStorage.setItem('activeControlButton', buttonName);
    }

    function logout() {
        localStorage.removeItem('token');
        window.location.reload();
    }

    return (
        <div className="Core">
            <div className="Sidebar">
                <div className="Buttons">
                    <ul className="SidebarButtons">
                        <Link to="/"><ControlButton active={homeActive} iconName="home-outline" onClick={() => {setActiveControlButton("home");}} /></Link>
                        <Link to="/upload"><ControlButton active={uploadActive} iconName="cloud-upload-outline" onClick={() => {setActiveControlButton("upload");}} /></Link>
                        <Link to="/files"><ControlButton active={filesActive} iconName="document-outline" onClick={() => {setActiveControlButton("files");}} /></Link>
                    </ul>
                </div>
                <div className="LogoutButtonWrapper">
                    <button className="Logout" onClick={logout}><ion-icon name="log-out-outline"></ion-icon></button>
                </div>
            </div>
            <div className="ContentPanel">
                <Switch>
                    <Route path="/" component={Home} exact />
                    <Route exact path="/upload" component={Upload} />
                    <Route exact path="/files" component={Files} />
                </Switch>
            </div>
        </div>
    );
}

export default Core;