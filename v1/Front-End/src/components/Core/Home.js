import './Home.css';
import Config from '../../Config';
import Authentication from '../../Authentication';
import axios from 'axios';

const serverURL = Config.SERVER_URL;

function Home() {
    async function changePassword(event) {
        event.preventDefault();
        const currentPassword = document.getElementById("ChngPwdCurrentPasswordInput").value;
        const newPassword = document.getElementById("ChngPwdNewPasswordInput").value;
        
        if(currentPassword && newPassword) {
            let url = serverURL + "/api/account/change";
            let currentToken = localStorage.getItem('token');
            let authorizationToken = "Bearer " + currentToken;
            
            let statusCode;
            try {
                const response = await Authentication.validateToken(currentToken);
                statusCode = response.status;
    
            }catch (e) {
                statusCode = e.response.status;
            }
            if(statusCode === 200) {
                let payload = {
                    toChange: "password",
                    currentPassword: currentPassword,
                    newPassword: newPassword
                }
        
                await axios({
                    url: url,
                    method: "POST",
                    headers: {'Content-Type': 'application/json', 'authorization': authorizationToken},
                    data: payload
                    
                }).then(response => {
                    if(response.status === 200) {
                        alert("Password Changed Successfully!");
                        localStorage.removeItem('token');
                        window.location.reload();
                    }
        
                }).catch(error => alert("Password Change Failed!"));

            }else {
                localStorage.removeItem('token');
                window.location.reload();
            }

        }else {
            alert("Invalid Input!");
        }

    }

    return (
        <div className="Home">
            <form className="ChangePasswordForm" onSubmit={changePassword}>
                <div className="ChangePassword">
                    <div className="ChngPwdInput currentpassword">
                        <input type="password" className="ChngPwdCurrentPasswordInput" id="ChngPwdCurrentPasswordInput" placeholder="Current Password"></input>
                    </div>
                    <div className="ChngPwdInput newpassword">
                        <input type="password" className="ChngPwdNewPasswordInput" id="ChngPwdNewPasswordInput" placeholder="New Password"></input>
                    </div>
                    <div className="ChngPwdInput submit">
                        <input type="submit" className="ChngPwdSubmitInput" value="Change"></input>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default Home;